import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Tools, EToolResources } from 'librechat-data-provider';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { ChatProjectKnowledgeFile } from '@librechat/data-schemas';
import type { ProjectContextAgent, ProjectContextDependencies } from './context';
import {
  loadProjectRunContext,
  planProjectKnowledge,
  applyProjectSearchFiles,
  resolveTurnProjectId,
  buildProjectSystemBlock,
  getKnowledgeInlineTokens,
  resolveProjectRunContext,
} from './context';

let mongoServer: MongoMemoryServer;
let db: ReturnType<typeof createMethods>;

const userId = new mongoose.Types.ObjectId().toString();
const otherUserId = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await mongoose.models.ChatProject.deleteMany({});
  await mongoose.models.File.deleteMany({});
});

const deps = (): ProjectContextDependencies => ({
  getChatProject: db.getChatProject,
  listChatProjectKnowledge: db.listChatProjectKnowledge,
  getChatProjectKnowledgeText: db.getChatProjectKnowledgeText,
});

async function createFile(fileId: string, text: string | null, embedded = false) {
  await mongoose.models.File.create({
    user: new mongoose.Types.ObjectId(userId),
    file_id: fileId,
    filename: `${fileId}.md`,
    filepath: `/uploads/${fileId}.md`,
    type: 'text/markdown',
    bytes: text?.length ?? 100,
    object: 'file',
    embedded,
    ...(text != null && { text }),
  });
}

async function createProject(instructions = '', fileIds: string[] = []): Promise<string> {
  const project = await db.createChatProject(userId, { name: 'Treasure Map', instructions });
  const projectId = project._id!.toString();
  if (fileIds.length > 0) {
    await db.addChatProjectKnowledge(userId, projectId, fileIds);
  }
  return projectId;
}

const knowledgeFile = (fileId: string, textLength: number): ChatProjectKnowledgeFile => ({
  file_id: fileId,
  filename: `${fileId}.md`,
  type: 'text/markdown',
  bytes: textLength,
  embedded: false,
  textLength,
});

describe('planProjectKnowledge', () => {
  const files = [knowledgeFile('a', 400), knowledgeFile('b', 400), knowledgeFile('img', 0)];

  it('reads everything in full when the text fits the budget', () => {
    const plan = planProjectKnowledge(files, 200, true);
    expect(plan.inline.map(({ file, maxChars }) => [file.file_id, maxChars])).toEqual([
      ['a', 400],
      ['b', 400],
    ]);
    expect(plan.search.map((file) => file.file_id)).toEqual(['img']);
  });

  it('switches every file to retrieval past the budget when retrieval is available', () => {
    const plan = planProjectKnowledge(files, 150, true);
    expect(plan.inline).toEqual([]);
    expect(plan.search.map((file) => file.file_id)).toEqual(['a', 'b', 'img']);
  });

  it('fills the budget in order and cuts the overflowing file without retrieval', () => {
    const plan = planProjectKnowledge(
      [knowledgeFile('a', 400), knowledgeFile('b', 400), knowledgeFile('c', 400)],
      150,
      false,
    );
    expect(plan.inline.map(({ file, maxChars }) => [file.file_id, maxChars])).toEqual([
      ['a', 400],
      ['b', 200],
    ]);
    expect(plan.omitted.map((file) => file.file_id)).toEqual(['c']);
    expect(plan.search).toEqual([]);
  });
});

describe('buildProjectSystemBlock', () => {
  it('is empty when the project has no instructions and no knowledge', () => {
    expect(
      buildProjectSystemBlock({ name: 'P', documents: [], searchFiles: [], omittedFiles: [] }),
    ).toBe('');
  });

  it('wraps instructions and documents in stable tags', () => {
    const block = buildProjectSystemBlock({
      name: 'Treasure "Map"',
      instructions: '  Always answer in pirate speak.  ',
      documents: [{ filename: 'crew.md', text: 'Captain: Anne\n', truncated: true }],
      searchFiles: [],
      omittedFiles: [],
    });
    expect(block).toBe(
      [
        'You are working in the user\'s project "Treasure  Map". Follow the project instructions in every reply. The project knowledge is reference material the user added.',
        '<project_instructions>\nAlways answer in pirate speak.\n</project_instructions>',
        '<project_knowledge>\n<document name="crew.md" truncated="true">\nCaptain: Anne\n</document>\n</project_knowledge>',
      ].join('\n\n'),
    );
  });

  it('names searchable and omitted files', () => {
    const block = buildProjectSystemBlock({
      name: 'P',
      documents: [],
      searchFiles: ['big.pdf'],
      omittedFiles: ['huge.md'],
    });
    expect(block).toContain('More project knowledge is in these files: big.pdf.');
    expect(block).toContain(Tools.file_search);
    expect(block).toContain('left out for length: huge.md');
  });
});

describe('resolveProjectRunContext', () => {
  it('puts instructions and small knowledge into one system block', async () => {
    await createFile('crew', 'Captain: Anne Bonny');
    await createFile('ship', 'Ship: Revenge');
    const projectId = await createProject('Always answer in pirate speak.', ['crew', 'ship']);

    const context = await resolveProjectRunContext(
      { userId, projectId, inlineTokenBudget: 6000, retrievalAvailable: false },
      deps(),
    );

    expect(context?.projectId).toBe(projectId);
    expect(context?.searchFileIds).toEqual([]);
    expect(context?.instructions).toContain(
      '<project_instructions>\nAlways answer in pirate speak.\n</project_instructions>',
    );
    const crewAt = context!.instructions.indexOf('Captain: Anne Bonny');
    const shipAt = context!.instructions.indexOf('Ship: Revenge');
    expect(crewAt).toBeGreaterThan(0);
    expect(shipAt).toBeGreaterThan(crewAt);
  });

  it('produces identical bytes on every turn so the prompt prefix can be cached', async () => {
    await createFile('crew', 'Captain: Anne Bonny');
    const projectId = await createProject('Arr.', ['crew']);
    const options = { userId, projectId, inlineTokenBudget: 6000, retrievalAvailable: false };

    const first = await resolveProjectRunContext(options, deps());
    const second = await resolveProjectRunContext(options, deps());
    expect(second?.instructions).toBe(first?.instructions);
  });

  it('sends large knowledge to file_search when retrieval is available', async () => {
    await createFile('log', 'x'.repeat(4000), true);
    const projectId = await createProject('', ['log']);

    const context = await resolveProjectRunContext(
      { userId, projectId, inlineTokenBudget: 100, retrievalAvailable: true },
      deps(),
    );

    expect(context?.searchFileIds).toEqual(['log']);
    expect(context?.instructions).not.toContain('xxxx');
    expect(context?.instructions).toContain('log.md');
  });

  it('cuts large knowledge to the budget when retrieval is unavailable', async () => {
    await createFile('log', 'y'.repeat(4000));
    const projectId = await createProject('', ['log']);

    const context = await resolveProjectRunContext(
      { userId, projectId, inlineTokenBudget: 100, retrievalAvailable: false },
      deps(),
    );

    expect(context?.searchFileIds).toEqual([]);
    expect(context?.instructions).toContain(`truncated="true">\n${'y'.repeat(400)}\n</document>`);
  });

  it("returns null for another user's project", async () => {
    const projectId = await createProject('Secret instructions');
    const context = await resolveProjectRunContext(
      { userId: otherUserId, projectId, inlineTokenBudget: 6000, retrievalAvailable: false },
      deps(),
    );
    expect(context).toBeNull();
  });

  it('adds nothing for a project without instructions or knowledge', async () => {
    const projectId = await createProject();
    const context = await resolveProjectRunContext(
      { userId, projectId, inlineTokenBudget: 6000, retrievalAvailable: false },
      deps(),
    );
    expect(context?.instructions).toBe('');
  });
});

describe('loadProjectRunContext', () => {
  it("uses a saved conversation's project, not the one the request names", async () => {
    const projectId = await createProject('Pirate speak.');
    const other = await db.createChatProject(userId, { name: 'Other', instructions: 'Formal.' });

    const context = await loadProjectRunContext(
      {
        userId,
        conversation: { chatProjectId: projectId },
        requestedProjectId: other._id!.toString(),
        retrievalAvailable: false,
      },
      deps(),
    );
    expect(context?.instructions).toContain('Pirate speak.');
  });

  it('runs the turn without a project when the read fails', async () => {
    const failing: ProjectContextDependencies = {
      ...deps(),
      getChatProject: () => Promise.reject(new Error('db down')),
    };
    const context = await loadProjectRunContext(
      { userId, requestedProjectId: 'abc', retrievalAvailable: false },
      failing,
    );
    expect(context).toBeNull();
  });
});

describe('resolveTurnProjectId', () => {
  it('ignores the requested project for a saved conversation outside any project', () => {
    expect(resolveTurnProjectId({ conversation: {}, requestedProjectId: 'p1' })).toBeNull();
  });

  it('uses the requested project for a new conversation', () => {
    expect(resolveTurnProjectId({ conversation: null, requestedProjectId: 'p1' })).toBe('p1');
  });
});

describe('applyProjectSearchFiles', () => {
  it('adds file_search and merges the files into its resource', () => {
    const agent: ProjectContextAgent = {
      tools: ['web_search'],
      tool_resources: { [EToolResources.file_search]: { file_ids: ['own'] } },
    };
    applyProjectSearchFiles(agent, {
      projectId: 'p',
      instructions: '',
      searchFileIds: ['k', 'own'],
      role: 'chat',
    });
    expect(agent.tools).toEqual(['web_search', Tools.file_search]);
    expect(agent.tool_resources?.[EToolResources.file_search]?.file_ids).toEqual(['own', 'k']);
  });

  it('leaves the agent alone when nothing needs searching', () => {
    const agent: ProjectContextAgent = { tools: [] };
    applyProjectSearchFiles(agent, {
      projectId: 'p',
      instructions: 'x',
      searchFileIds: [],
      role: 'chat',
    });
    expect(agent).toEqual({ tools: [] });
  });
});

describe('getKnowledgeInlineTokens', () => {
  it('defaults when unset and reads the configured value', () => {
    expect(getKnowledgeInlineTokens(undefined)).toBe(6000);
    expect(getKnowledgeInlineTokens({ knowledgeInlineTokens: 0 })).toBe(0);
  });
});
