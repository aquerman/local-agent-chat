import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  MAX_CHAT_PROJECT_KNOWLEDGE_FILES,
  MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH,
} from 'librechat-data-provider';
import type { IMongoFile } from '~/types';
import {
  createChatProjectMethods,
  CHAT_PROJECT_KNOWLEDGE_LIMIT_ERROR,
  CHAT_PROJECT_KNOWLEDGE_FILE_NOT_FOUND,
  type ChatProjectMethods,
} from './chatProject';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let File: mongoose.Model<IMongoFile>;
let methods: ChatProjectMethods;
let modelsToCleanup: string[] = [];

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  modelsToCleanup = Object.keys(models);
  Object.assign(mongoose.models, models);
  File = mongoose.models.File as mongoose.Model<IMongoFile>;
  methods = createChatProjectMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  for (const modelName of modelsToCleanup) {
    delete mongoose.models[modelName];
  }
});

afterEach(async () => {
  await mongoose.models.ChatProject.deleteMany({});
  await File.deleteMany({});
});

async function createFile(owner: string, fileId: string, text?: string, embedded = false) {
  await File.create({
    user: new mongoose.Types.ObjectId(owner),
    file_id: fileId,
    filename: `${fileId}.md`,
    filepath: `/uploads/${fileId}.md`,
    type: 'text/markdown',
    bytes: text?.length ?? 10,
    object: 'file',
    embedded,
    ...(text != null && { text }),
  });
}

async function createProject(owner = user): Promise<string> {
  const project = await methods.createChatProject(owner, { name: 'Pirates' });
  return project._id!.toString();
}

describe('ChatProject instructions', () => {
  it('stores, trims and caps instructions on create and update', async () => {
    const created = await methods.createChatProject(user, {
      name: 'Pirates',
      instructions: '  Always answer in pirate speak.  ',
    });
    expect(created.instructions).toBe('Always answer in pirate speak.');

    const long = 'x'.repeat(MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH + 50);
    const updated = await methods.updateChatProject(user, created._id!.toString(), {
      instructions: long,
    });
    expect(updated?.instructions).toHaveLength(MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH);
    expect(updated?.name).toBe('Pirates');

    const cleared = await methods.updateChatProject(user, created._id!.toString(), {
      instructions: '',
    });
    expect(cleared?.instructions).toBe('');
  });

  it('leaves instructions alone when an update does not mention them', async () => {
    const created = await methods.createChatProject(user, {
      name: 'Pirates',
      instructions: 'Arr.',
    });
    const renamed = await methods.updateChatProject(user, created._id!.toString(), {
      name: 'Buccaneers',
    });
    expect(renamed?.instructions).toBe('Arr.');
  });
});

describe('ChatProject knowledge', () => {
  it('adds owned files in order and lists them with text sizes but no text', async () => {
    const projectId = await createProject();
    await createFile(user, 'file-b', 'second file');
    await createFile(user, 'file-a', 'héllo', true);

    const updated = await methods.addChatProjectKnowledge(user, projectId, ['file-b', 'file-a']);
    expect(updated?.knowledgeFileIds).toEqual(['file-b', 'file-a']);

    const files = await methods.listChatProjectKnowledge(user, projectId);
    expect(files).toEqual([
      expect.objectContaining({ file_id: 'file-b', textLength: 11, embedded: false }),
      expect.objectContaining({ file_id: 'file-a', textLength: 5, embedded: true }),
    ]);
    expect(files?.[0]).not.toHaveProperty('text');
  });

  it('does not duplicate a file added twice', async () => {
    const projectId = await createProject();
    await createFile(user, 'file-a', 'a');
    await methods.addChatProjectKnowledge(user, projectId, ['file-a']);
    const updated = await methods.addChatProjectKnowledge(user, projectId, ['file-a', 'file-a']);
    expect(updated?.knowledgeFileIds).toEqual(['file-a']);
  });

  it("refuses another user's file and leaves the project unchanged", async () => {
    const projectId = await createProject();
    await createFile(otherUser, 'theirs', 'secret');

    await expect(methods.addChatProjectKnowledge(user, projectId, ['theirs'])).rejects.toThrow(
      CHAT_PROJECT_KNOWLEDGE_FILE_NOT_FOUND,
    );
    expect(await methods.listChatProjectKnowledge(user, projectId)).toEqual([]);
  });

  it("returns null for another user's project", async () => {
    const projectId = await createProject(otherUser);
    await createFile(user, 'file-a', 'a');

    expect(await methods.addChatProjectKnowledge(user, projectId, ['file-a'])).toBeNull();
    expect(await methods.listChatProjectKnowledge(user, projectId)).toBeNull();
    expect(await methods.removeChatProjectKnowledge(user, projectId, 'file-a')).toBeNull();
  });

  it('enforces the file limit, counting the files already there', async () => {
    const projectId = await createProject();
    const ids = Array.from({ length: MAX_CHAT_PROJECT_KNOWLEDGE_FILES }, (_, i) => `f-${i}`);
    for (const id of ids) {
      await createFile(user, id, id);
    }
    await createFile(user, 'one-more', 'x');

    await methods.addChatProjectKnowledge(user, projectId, ids);
    await expect(methods.addChatProjectKnowledge(user, projectId, ['one-more'])).rejects.toThrow(
      CHAT_PROJECT_KNOWLEDGE_LIMIT_ERROR,
    );
    const files = await methods.listChatProjectKnowledge(user, projectId);
    expect(files).toHaveLength(MAX_CHAT_PROJECT_KNOWLEDGE_FILES);
  });

  it('removes a file from the project and skips files deleted since', async () => {
    const projectId = await createProject();
    await createFile(user, 'file-a', 'a');
    await createFile(user, 'file-b', 'b');
    await methods.addChatProjectKnowledge(user, projectId, ['file-a', 'file-b']);

    const removed = await methods.removeChatProjectKnowledge(user, projectId, 'file-a');
    expect(removed?.knowledgeFileIds).toEqual(['file-b']);

    await File.deleteOne({ file_id: 'file-b' });
    expect(await methods.listChatProjectKnowledge(user, projectId)).toEqual([]);
  });

  it('reads text only for the requested files the user owns, in the requested order', async () => {
    await createFile(user, 'file-a', 'alpha');
    await createFile(user, 'file-b', 'beta');
    await createFile(user, 'no-text');
    await createFile(otherUser, 'theirs', 'secret');

    const texts = await methods.getChatProjectKnowledgeText(user, [
      'file-b',
      'no-text',
      'theirs',
      'file-a',
    ]);
    expect(texts).toEqual([
      { file_id: 'file-b', text: 'beta' },
      { file_id: 'file-a', text: 'alpha' },
    ]);
  });
});
