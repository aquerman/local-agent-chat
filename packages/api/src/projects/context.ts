import { logger } from '@librechat/data-schemas';
import { Tools, EToolResources, projectsConfigSchema } from 'librechat-data-provider';
import type {
  IChatProject,
  ChatProjectMethods,
  ChatProjectKnowledgeFile,
} from '@librechat/data-schemas';
import type { TProjectsConfig, AgentToolResources } from 'librechat-data-provider';

/** Rough characters per token for sizing knowledge without tokenizing it on every turn. */
export const KNOWLEDGE_CHARS_PER_TOKEN = 4;

export type ProjectContextDependencies = Pick<
  ChatProjectMethods,
  'getChatProject' | 'listChatProjectKnowledge' | 'getChatProjectKnowledgeText'
>;

export type ProjectContextOptions = {
  userId: string;
  projectId?: string | null;
  /** Knowledge up to this many (estimated) tokens goes into the system prompt. */
  inlineTokenBudget: number;
  /** Whether the chat can search files with `file_search`: capability, role grant and RAG API. */
  retrievalAvailable: boolean;
};

/** What a project adds to one chat turn. */
export type ProjectRunContext = {
  projectId: string;
  /** System block for the agent's stable instructions; empty when the project adds nothing. */
  instructions: string;
  /** Knowledge files the chat searches with `file_search` instead of reading them in full. */
  searchFileIds: string[];
};

type InlineDocument = {
  filename: string;
  text: string;
  truncated: boolean;
};

type KnowledgePlan = {
  inline: Array<{ file: ChatProjectKnowledgeFile; maxChars: number }>;
  search: ChatProjectKnowledgeFile[];
  omitted: ChatProjectKnowledgeFile[];
};

/** The agent fields a project context touches. */
export type ProjectContextAgent = {
  tools?: string[];
  tool_resources?: AgentToolResources;
};

/**
 * Decides where each knowledge file goes, the way Claude Projects does: when all the text fits
 * the budget it is read in full; past it, the project switches to retrieval when it can, and
 * otherwise reads files in order until the budget runs out, cutting the one that overflows.
 */
export function planProjectKnowledge(
  files: ChatProjectKnowledgeFile[],
  inlineTokenBudget: number,
  retrievalAvailable: boolean,
): KnowledgePlan {
  const budgetChars = Math.max(0, inlineTokenBudget) * KNOWLEDGE_CHARS_PER_TOKEN;
  const textFiles = files.filter((file) => file.textLength > 0);
  const totalChars = textFiles.reduce((sum, file) => sum + file.textLength, 0);
  const withoutText = files.filter((file) => file.textLength === 0);

  if (totalChars <= budgetChars) {
    return {
      inline: textFiles.map((file) => ({ file, maxChars: file.textLength })),
      search: retrievalAvailable ? withoutText : [],
      omitted: retrievalAvailable ? [] : withoutText,
    };
  }

  if (retrievalAvailable) {
    return { inline: [], search: files, omitted: [] };
  }

  const plan: KnowledgePlan = { inline: [], search: [], omitted: [...withoutText] };
  let remaining = budgetChars;
  for (const file of textFiles) {
    if (remaining <= 0) {
      plan.omitted.push(file);
      continue;
    }
    plan.inline.push({ file, maxChars: Math.min(file.textLength, remaining) });
    remaining -= file.textLength;
  }
  return plan;
}

const attribute = (value: string): string => value.replace(/["\n\r]/g, ' ').trim();

/** Builds the project's system block. Pure, so the same project yields the same bytes and
 *  llama-server can reuse its cached prompt prefix from one turn to the next. */
export function buildProjectSystemBlock({
  name,
  instructions,
  documents,
  searchFiles,
  omittedFiles,
}: {
  name: string;
  instructions?: string;
  documents: InlineDocument[];
  searchFiles: string[];
  omittedFiles: string[];
}): string {
  const trimmedInstructions = instructions?.trim() ?? '';
  const hasKnowledge = documents.length + searchFiles.length + omittedFiles.length > 0;
  if (!trimmedInstructions && !hasKnowledge) {
    return '';
  }

  const parts = [
    `You are working in the user's project "${attribute(name)}".` +
      (trimmedInstructions ? ' Follow the project instructions in every reply.' : '') +
      (hasKnowledge ? ' The project knowledge is reference material the user added.' : ''),
  ];
  if (trimmedInstructions) {
    parts.push(`<project_instructions>\n${trimmedInstructions}\n</project_instructions>`);
  }
  if (documents.length > 0) {
    const body = documents
      .map(
        (doc) =>
          `<document name="${attribute(doc.filename)}"${doc.truncated ? ' truncated="true"' : ''}>\n${doc.text.trim()}\n</document>`,
      )
      .join('\n');
    parts.push(`<project_knowledge>\n${body}\n</project_knowledge>`);
  }
  if (searchFiles.length > 0) {
    parts.push(
      `More project knowledge is in these files: ${searchFiles.map(attribute).join(', ')}. ` +
        'Search them with the file_search tool when a question may concern them.',
    );
  }
  if (omittedFiles.length > 0) {
    parts.push(
      `These project files were left out for length: ${omittedFiles.map(attribute).join(', ')}.`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Resolves what a project adds to a chat turn: its instructions and knowledge as one system
 * block, and the files to search. Null when the chat is in no project, or in one the user
 * does not own. Only the text of files that go into the prompt is read.
 */
export async function resolveProjectRunContext(
  options: ProjectContextOptions,
  deps: ProjectContextDependencies,
): Promise<ProjectRunContext | null> {
  const { userId, projectId } = options;
  if (!userId || typeof projectId !== 'string' || projectId.length === 0) {
    return null;
  }

  const [project, files] = await Promise.all([
    deps.getChatProject(userId, projectId),
    deps.listChatProjectKnowledge(userId, projectId),
  ]);
  if (!project) {
    return null;
  }

  const plan = planProjectKnowledge(
    files ?? [],
    options.inlineTokenBudget,
    options.retrievalAvailable,
  );
  const documents = await readInlineDocuments(userId, plan, deps);
  const instructions = buildProjectSystemBlock({
    name: project.name,
    instructions: project.instructions,
    documents,
    searchFiles: plan.search.map((file) => file.filename),
    omittedFiles: plan.omitted.map((file) => file.filename),
  });

  return {
    projectId: projectIdOf(project, projectId),
    instructions,
    searchFileIds: plan.search.map((file) => file.file_id),
  };
}

async function readInlineDocuments(
  userId: string,
  plan: KnowledgePlan,
  deps: ProjectContextDependencies,
): Promise<InlineDocument[]> {
  if (plan.inline.length === 0) {
    return [];
  }
  const texts = await deps.getChatProjectKnowledgeText(
    userId,
    plan.inline.map(({ file }) => file.file_id),
  );
  const textById = new Map(texts.map((entry) => [entry.file_id, entry.text]));
  return plan.inline.flatMap(({ file, maxChars }) => {
    const text = textById.get(file.file_id);
    if (!text) {
      return [];
    }
    return [
      {
        filename: file.filename,
        text: text.slice(0, maxChars),
        truncated: maxChars < text.length,
      },
    ];
  });
}

const projectIdOf = (project: IChatProject, fallback: string): string =>
  project._id?.toString() ?? fallback;

/**
 * Gives the agent the project's searchable knowledge: adds `file_search` to its tools and the
 * files to its `file_search` resource. Mutates the agent, which is loaded fresh per request.
 */
export function applyProjectSearchFiles(
  agent: ProjectContextAgent,
  context: ProjectRunContext | null,
): void {
  if (!context || context.searchFileIds.length === 0) {
    return;
  }
  const tools = agent.tools ?? [];
  if (!tools.includes(Tools.file_search)) {
    agent.tools = [...tools, Tools.file_search];
  }
  const resources = agent.tool_resources ?? {};
  const existing = resources[EToolResources.file_search];
  const fileIds = [...new Set([...(existing?.file_ids ?? []), ...context.searchFileIds])];
  agent.tool_resources = {
    ...resources,
    [EToolResources.file_search]: { ...existing, file_ids: fileIds },
  };
}

/**
 * The project a chat turn belongs to. A saved conversation answers for itself, so a request
 * cannot borrow another project's instructions; a new one uses the project it is started in.
 */
export function resolveTurnProjectId({
  conversation,
  requestedProjectId,
}: {
  conversation?: { chatProjectId?: string | null } | null;
  requestedProjectId?: string | null;
}): string | null {
  if (conversation) {
    return conversation.chatProjectId ?? null;
  }
  return typeof requestedProjectId === 'string' && requestedProjectId.length > 0
    ? requestedProjectId
    : null;
}

/** `projects.knowledgeInlineTokens` from the app config, or its default. */
export function getKnowledgeInlineTokens(projects?: Partial<TProjectsConfig> | null): number {
  const parsed = projectsConfigSchema.safeParse(projects ?? {});
  return parsed.success
    ? parsed.data.knowledgeInlineTokens
    : projectsConfigSchema.parse({}).knowledgeInlineTokens;
}

/**
 * The agent-run entry point: works out the turn's project and resolves its context. A failed
 * read is logged and the turn runs without the project rather than not at all.
 */
export async function loadProjectRunContext(
  {
    userId,
    conversation,
    requestedProjectId,
    projectsConfig,
    retrievalAvailable,
  }: {
    userId: string;
    conversation?: { chatProjectId?: string | null } | null;
    requestedProjectId?: string | null;
    projectsConfig?: Partial<TProjectsConfig> | null;
    retrievalAvailable: boolean;
  },
  deps: ProjectContextDependencies,
): Promise<ProjectRunContext | null> {
  const projectId = resolveTurnProjectId({ conversation, requestedProjectId });
  if (!projectId) {
    return null;
  }
  try {
    return await resolveProjectRunContext(
      {
        userId,
        projectId,
        inlineTokenBudget: getKnowledgeInlineTokens(projectsConfig),
        retrievalAvailable,
      },
      deps,
    );
  } catch (error) {
    logger.error('[projects] Failed to load project context; running the turn without it', error);
    return null;
  }
}
