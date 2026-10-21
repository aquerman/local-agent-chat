import { logger } from '@librechat/data-schemas';
import { Tools, EToolResources, projectsConfigSchema } from 'librechat-data-provider';
import type {
  IChatProject,
  IProjectThread,
  ChatProjectMethods,
  ProjectThreadMethods,
  ChatProjectKnowledgeFile,
} from '@librechat/data-schemas';
import type {
  TProjectsConfig,
  AgentToolResources,
  TProjectThreadsConfig,
} from 'librechat-data-provider';

/** Rough characters per token for sizing knowledge without tokenizing it on every turn. */
export const KNOWLEDGE_CHARS_PER_TOKEN = 4;

export type ProjectContextDependencies = Pick<
  ChatProjectMethods,
  'getChatProject' | 'listChatProjectKnowledge' | 'getChatProjectKnowledgeText'
> &
  Partial<
    Pick<ChatProjectMethods, 'claimChatProjectCoordinator'> &
      Pick<ProjectThreadMethods, 'getProjectThreadByConversation' | 'listFinishedProjectThreads'>
  > & {
    /** Whether a chat still exists, so a deleted coordinator chat can be replaced. */
    conversationExists?: (userId: string, conversationId: string) => Promise<boolean>;
  };

/** What a chat is to its project: the coordinator, a task thread, or any other chat. */
export type ProjectChatRole = 'chat' | 'coordinator' | 'thread';

export type ProjectContextOptions = {
  userId: string;
  projectId?: string | null;
  /** Knowledge up to this many (estimated) tokens goes into the system prompt. */
  inlineTokenBudget: number;
  /** Whether the chat can search files with `file_search`: capability, role grant and RAG API. */
  retrievalAvailable: boolean;
  /** The chat this turn runs in; needed to tell the coordinator and threads apart. */
  conversationId?: string | null;
  /** Coordinator and threads (roadmap P1b/P1c); off when absent. */
  threads?: Pick<TProjectThreadsConfig, 'enabled' | 'indexLimit'>;
};

/** What a project adds to one chat turn. */
export type ProjectRunContext = {
  projectId: string;
  /** System block for the agent's stable instructions; empty when the project adds nothing. */
  instructions: string;
  /** Knowledge files the chat searches with `file_search` instead of reading them in full. */
  searchFileIds: string[];
  role: ProjectChatRole;
};

/** One finished thread in the coordinator's summary index. */
export type ThreadIndexEntry = {
  id: string;
  title: string;
  status: string;
  summary?: string;
  error?: string;
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
  coordinator,
}: {
  name: string;
  instructions?: string;
  documents: InlineDocument[];
  searchFiles: string[];
  omittedFiles: string[];
  /** Present for the project's coordinator chat: its finished threads, newest first. */
  coordinator?: { threads: ThreadIndexEntry[] };
}): string {
  const trimmedInstructions = instructions?.trim() ?? '';
  const hasKnowledge = documents.length + searchFiles.length + omittedFiles.length > 0;
  if (!trimmedInstructions && !hasKnowledge && !coordinator) {
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
  if (coordinator) {
    parts.push(buildCoordinatorBlock(coordinator.threads));
  }
  return parts.join('\n\n');
}

/**
 * The coordinator's part of the project block: its role and the summary index of finished
 * threads. Running threads are left out, so the block changes only when a thread finishes and
 * llama-server keeps the cached prefix between turns.
 */
export function buildCoordinatorBlock(threads: ThreadIndexEntry[]): string {
  const role =
    "You are this project's coordinator. When the user asks for work that takes research or " +
    'several steps, start a background task thread with start_thread and a self-contained ' +
    'brief, tell the user it started, and keep talking. Finished threads appear below; use ' +
    'list_threads for running ones, read_summary for one thread, post_to_thread to follow up.';
  if (threads.length === 0) {
    return role;
  }
  const body = threads
    .map((thread) => {
      const text = (thread.summary || thread.error || '').trim();
      return `<thread id="${attribute(thread.id)}" title="${attribute(thread.title)}" status="${attribute(thread.status)}">\n${text}\n</thread>`;
    })
    .join('\n');
  return `${role}\n<project_threads>\n${body}\n</project_threads>`;
}

const toIndexEntry = (thread: IProjectThread): ThreadIndexEntry => ({
  id: thread._id?.toString() ?? '',
  title: thread.title,
  status: thread.status,
  summary: thread.summary,
  error: thread.error,
});

/**
 * Decides whether this chat is the project's coordinator, one of its threads, or neither. The
 * first other chat to run a turn in a project becomes its coordinator; when that chat is
 * deleted, the next one takes over.
 */
export async function resolveProjectChatRole(
  {
    userId,
    projectId,
    conversationId,
    project,
  }: {
    userId: string;
    projectId: string;
    conversationId?: string | null;
    project: IChatProject;
  },
  deps: ProjectContextDependencies,
): Promise<ProjectChatRole> {
  if (!conversationId || conversationId === 'new' || !deps.claimChatProjectCoordinator) {
    return 'chat';
  }
  const thread = await deps.getProjectThreadByConversation?.(userId, conversationId);
  if (thread) {
    return 'thread';
  }
  const current = project.coordinatorConversationId;
  if (current === conversationId) {
    return 'coordinator';
  }
  if (current && (await deps.conversationExists?.(userId, current)) !== false) {
    return 'chat';
  }
  const claimed = await deps.claimChatProjectCoordinator(
    userId,
    projectId,
    conversationId,
    current ?? undefined,
  );
  return claimed === conversationId ? 'coordinator' : 'chat';
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
  const resolvedProjectId = projectIdOf(project, projectId);
  const role =
    options.threads?.enabled === true
      ? await resolveProjectChatRole(
          { userId, projectId: resolvedProjectId, conversationId: options.conversationId, project },
          deps,
        )
      : 'chat';
  const [documents, finished] = await Promise.all([
    readInlineDocuments(userId, plan, deps),
    role === 'coordinator'
      ? (deps.listFinishedProjectThreads?.(
          userId,
          resolvedProjectId,
          options.threads?.indexLimit ?? 0,
        ) ?? Promise.resolve([]))
      : Promise.resolve([]),
  ]);
  const instructions = buildProjectSystemBlock({
    name: project.name,
    instructions: project.instructions,
    documents,
    searchFiles: plan.search.map((file) => file.filename),
    omittedFiles: plan.omitted.map((file) => file.filename),
    ...(role === 'coordinator' && { coordinator: { threads: finished.map(toIndexEntry) } }),
  });

  return {
    projectId: resolvedProjectId,
    instructions,
    searchFileIds: plan.search.map((file) => file.file_id),
    role,
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

/** `projects.threads` from the app config, with defaults (off). */
export function getThreadsSettings(
  projects?: Partial<TProjectsConfig> | null,
): TProjectThreadsConfig {
  const parsed = projectsConfigSchema.safeParse(projects ?? {});
  return parsed.success ? parsed.data.threads : projectsConfigSchema.parse({}).threads;
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
    conversationId,
  }: {
    userId: string;
    conversationId?: string | null;
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
        conversationId,
        threads: getThreadsSettings(projectsConfig),
      },
      deps,
    );
  } catch (error) {
    logger.error('[projects] Failed to load project context; running the turn without it', error);
    return null;
  }
}
