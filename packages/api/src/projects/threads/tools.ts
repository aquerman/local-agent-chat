import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import type { IProjectThread } from '@librechat/data-schemas';
import type { GenericTool } from '@librechat/agents';
import type { ProjectThreadService } from './service';
import { ProjectThreadError } from './service';

export const START_THREAD_TOOL = 'start_thread';
export const LIST_THREADS_TOOL = 'list_threads';
export const READ_SUMMARY_TOOL = 'read_summary';
export const POST_TO_THREAD_TOOL = 'post_to_thread';

/** Names of the coordinator's thread tools, for approval allow-lists and docs. */
export const PROJECT_THREAD_TOOL_NAMES: readonly string[] = [
  START_THREAD_TOOL,
  LIST_THREADS_TOOL,
  READ_SUMMARY_TOOL,
  POST_TO_THREAD_TOOL,
];

/** Who is calling: the coordinator chat of one project. */
export type CoordinatorToolContext = {
  userId: string;
  tenantId?: string;
  projectId: string;
  coordinatorConversationId: string;
  /** The agent new threads run on. */
  agentId: string;
  /**
   * Longest brief the service accepts. Named in the description, not as a schema `max`: every
   * bound becomes a grammar repetition in llama-server, which refuses bounds of 2000 or more.
   */
  briefMaxChars: number;
};

const STATUS_WORDS: Record<IProjectThread['status'], string> = {
  working: 'working',
  needs_you: 'needs the user',
  done: 'done',
  failed: 'failed',
};

const STATUS_NOTES: Partial<Record<IProjectThread['status'], string>> = {
  working: 'Still working; the summary is written when it finishes.',
  needs_you: 'Paused: the user must answer or approve something in that thread.',
};

const threadId = (thread: IProjectThread): string => thread._id?.toString() ?? '';

const describe = (thread: IProjectThread) => ({
  thread_id: threadId(thread),
  title: thread.title,
  status: STATUS_WORDS[thread.status],
});

const failure = (error: unknown): string => {
  if (error instanceof ProjectThreadError) {
    return `Error: ${error.message}`;
  }
  logger.error('[projects/threads] Tool call failed', error);
  return 'Error: the thread service failed. Tell the user and try again later.';
};

/**
 * The coordinator's four thread tools. They run in-process inside the graph (`graphTools`),
 * bound to one user and project, so a model can never reach another project's threads.
 */
export function createProjectThreadTools(
  context: CoordinatorToolContext,
  service: ProjectThreadService,
): GenericTool[] {
  const { userId, projectId } = context;

  const startThread = tool(
    async ({ title, brief }) => {
      try {
        const thread = await service.startThread({
          userId,
          tenantId: context.tenantId,
          projectId,
          coordinatorConversationId: context.coordinatorConversationId,
          agentId: context.agentId,
          title,
          brief,
        });
        return JSON.stringify({
          ...describe(thread),
          note: 'Queued. It runs in the background after this reply; its summary reaches you when it is done.',
        });
      } catch (error) {
        return failure(error);
      }
    },
    {
      name: START_THREAD_TOOL,
      description:
        'Start a background task thread in this project: a separate chat that works on one task ' +
        'on its own (research, writing, several tool steps) while the user keeps talking to you. ' +
        'The thread starts empty and cannot see this chat, so the brief must contain everything ' +
        'it needs: the goal, the facts and constraints the user gave, and what the result should ' +
        'look like. Threads run one at a time after your reply. Tell the user you started it.',
      schema: z
        .object({
          title: z.string().min(1).max(120).describe('Short name of the task, 3-8 words.'),
          brief: z
            .string()
            .min(1)
            .describe(
              `The whole task, self-contained (at most ${context.briefMaxChars} characters).`,
            ),
        })
        .strict(),
    },
  );

  const listThreads = tool(
    async () => {
      try {
        const threads = await service.listThreads(userId, projectId);
        if (threads.length === 0) {
          return 'No threads in this project yet.';
        }
        return JSON.stringify(threads.map(describe));
      } catch (error) {
        return failure(error);
      }
    },
    {
      name: LIST_THREADS_TOOL,
      description:
        "List this project's task threads, newest first, with their id, title and status " +
        '(working, needs the user, done, failed).',
      schema: z.object({}).strict(),
    },
  );

  const readSummary = tool(
    async ({ thread_id }) => {
      try {
        const thread = await service.getThread(userId, projectId, thread_id);
        if (!thread) {
          return 'Error: no thread with that id in this project. Use list_threads.';
        }
        return JSON.stringify({
          ...describe(thread),
          summary: thread.summary || undefined,
          error: thread.error || undefined,
          note: STATUS_NOTES[thread.status],
        });
      } catch (error) {
        return failure(error);
      }
    },
    {
      name: READ_SUMMARY_TOOL,
      description: "Read one thread's status and the summary it handed back when it finished.",
      schema: z
        .object({ thread_id: z.string().min(1).max(64).describe('Id from list_threads.') })
        .strict(),
    },
  );

  const postToThread = tool(
    async ({ thread_id, text }) => {
      try {
        const thread = await service.postToThread({ userId, projectId, threadId: thread_id, text });
        return JSON.stringify({
          ...describe(thread),
          note: 'Sent. The thread works on it in the background and writes a new summary.',
        });
      } catch (error) {
        return failure(error);
      }
    },
    {
      name: POST_TO_THREAD_TOOL,
      description:
        'Send a follow-up message to an existing thread (more detail, a correction, a next ' +
        'step). The thread continues in the background and hands back a new summary.',
      schema: z
        .object({
          thread_id: z.string().min(1).max(64).describe('Id from list_threads.'),
          text: z.string().min(1).describe('The message, self-contained.'),
        })
        .strict(),
    },
  );

  return [startThread, listThreads, readSummary, postToThread] as unknown as GenericTool[];
}

/**
 * The thread tools for one chat turn: only the project's coordinator chat gets them, with
 * threads enabled and an agent to run them on (its own saved agent, or `threads.agentId`
 * when the coordinator is a plain endpoint chat).
 */
export function resolveCoordinatorTools({
  role,
  projectId,
  userId,
  tenantId,
  conversationId,
  agentId,
  agentIsEphemeral,
  threads,
  getService,
}: {
  role?: 'chat' | 'coordinator' | 'thread';
  projectId?: string;
  userId: string;
  tenantId?: string;
  conversationId?: string | null;
  agentId?: string | null;
  agentIsEphemeral: boolean;
  threads: { enabled: boolean; agentId?: string; briefMaxChars: number };
  /** Called only when the tools are given, so other turns never build the thread runner. */
  getService: () => ProjectThreadService;
}): GenericTool[] | undefined {
  if (role !== 'coordinator' || !threads.enabled || !projectId || !conversationId) {
    return undefined;
  }
  const threadAgentId = agentIsEphemeral || !agentId ? threads.agentId : agentId;
  if (!threadAgentId) {
    return undefined;
  }
  return createProjectThreadTools(
    {
      userId,
      tenantId,
      projectId,
      coordinatorConversationId: conversationId,
      agentId: threadAgentId,
      briefMaxChars: threads.briefMaxChars,
    },
    getService(),
  );
}
