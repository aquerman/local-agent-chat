import { randomUUID } from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import { projectThreadsConfigSchema } from 'librechat-data-provider';
import type {
  IProjectThread,
  ProjectThreadStatus,
  ProjectThreadMethods,
} from '@librechat/data-schemas';
import type { TProjectThreadsConfig } from 'librechat-data-provider';
import type { AgentTriggerEnvelope } from '~/agents/triggers/envelope';
import type { ThreadMessage, ThreadSummarizer } from './summary';
import { extractMessageText, fallbackSummary, findFinalReply } from './summary';
import { createAgentTriggerEnvelope } from '~/agents/triggers/envelope';

/** `event.source.type` of every trigger a project thread sends. */
export const PROJECT_THREAD_SOURCE = 'project_thread';
export const PROJECT_THREAD_EVENT_TYPE = 'project_thread.run';

/** A dispatched thread with no generation after this long is checked against its messages. */
const ADMISSION_GRACE_MS = 2 * 60_000;
/** A dispatched thread with no generation and no reply after this long has failed. */
const LOST_AFTER_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 15_000;

type GenerationStatus = 'running' | 'complete' | 'error' | 'aborted' | 'requires_action';

export type ProjectThreadPrincipal = { id: string; role?: string; tenantId?: string };

export type ProjectThreadServiceDeps = {
  methods: Pick<
    ProjectThreadMethods,
    | 'createProjectThread'
    | 'getProjectThread'
    | 'listProjectThreads'
    | 'countRunningProjectThreads'
    | 'listDispatchedProjectThreads'
    | 'claimNextQueuedProjectThread'
    | 'queueProjectThreadInput'
    | 'beginProjectThreadSettle'
    | 'requeueProjectThread'
    | 'finishProjectThread'
    | 'setDispatchedProjectThreadStatus'
    | 'setConversationThreadStatus'
  >;
  /** The thread chat's messages, oldest first. */
  getMessages: (userId: string, conversationId: string) => Promise<ThreadMessage[]>;
  enqueueTrigger: (
    envelope: AgentTriggerEnvelope,
    options: { orderingKey: string },
  ) => Promise<unknown>;
  getGenerationStatus: (conversationId: string) => Promise<GenerationStatus | undefined>;
  /** Generations running now across the server; a thread waits while live chat uses the GPU. */
  getRunningGenerationCount: () => Promise<number>;
  getPrincipal: (userId: string) => Promise<ProjectThreadPrincipal | null>;
  getConfig: () => Promise<Partial<TProjectThreadsConfig> | undefined>;
  /** Summary step for the thread's agent; the start of the reply is used without it. */
  createSummarizer?: (agentId: string) => ThreadSummarizer;
  /**
   * Called after a thread's status changes. The hook point for notifications (the Notifier
   * interface of roadmap N15 once it lands); errors are logged, never thrown.
   */
  onStatusChange?: (thread: IProjectThread) => void | Promise<void>;
  now?: () => number;
};

export type StartProjectThreadInput = {
  userId: string;
  tenantId?: string;
  projectId: string;
  coordinatorConversationId?: string | null;
  agentId: string;
  title: string;
  brief: string;
};

export class ProjectThreadError extends Error {}

/** The first message of a thread. A thread starts empty, so it carries the whole task. */
export function renderThreadBrief(title: string, brief: string): string {
  return (
    "This chat is a task thread started by the project's coordinator. Work on the task below " +
    'on your own and finish with a clear final answer; it is summarized for the coordinator.\n\n' +
    `Task: ${title}\n\n${brief}`
  );
}

export function getThreadsConfig(
  value: Partial<TProjectThreadsConfig> | undefined | null,
): TProjectThreadsConfig {
  const parsed = projectThreadsConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : projectThreadsConfigSchema.parse({});
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs project task threads as background agent runs, one GPU slot at a time, behind live
 * chat. A thread is queued in Mongo, sent through the durable agent trigger queue as a new
 * chat (or a follow-up turn), watched through generation settlement plus a periodic sweep,
 * and finished with a short summary for the coordinator.
 */
export interface ProjectThreadService {
  startThread(input: StartProjectThreadInput): Promise<IProjectThread>;
  postToThread(input: {
    userId: string;
    projectId: string;
    threadId: string;
    text: string;
  }): Promise<IProjectThread>;
  listThreads(userId: string, projectId: string): Promise<IProjectThread[]>;
  getThread(userId: string, projectId: string, threadId: string): Promise<IProjectThread | null>;
  pump(): Promise<void>;
  sweep(): Promise<void>;
  handleSettled(event: SettledThreadEvent): Promise<void>;
  onGenerationSettled(event: SettledThreadEvent): void;
  start(intervalMs?: number): void;
  stop(): void;
}

export type SettledThreadEvent = {
  userId: string;
  conversationId: string;
  status: 'complete' | 'error' | 'aborted';
};

export function createProjectThreadService(deps: ProjectThreadServiceDeps): ProjectThreadService {
  const { methods } = deps;
  const now = deps.now ?? Date.now;
  let pumping: Promise<void> | null = null;
  let pumpAgain = false;
  let timer: NodeJS.Timeout | null = null;
  /** Runs whose chat already shows their status and title, so a sweep writes each only once. */
  const mirroredRuns = new Set<string>();

  const notify = async (thread: IProjectThread | null) => {
    if (!thread || !deps.onStatusChange) {
      return;
    }
    try {
      await deps.onStatusChange(thread);
    } catch (error) {
      logger.error('[projects/threads] Status hook failed', error);
    }
  };

  const mirror = async (thread: IProjectThread | null, status?: ProjectThreadStatus) => {
    if (!thread) {
      return;
    }
    try {
      await methods.setConversationThreadStatus(
        thread.user,
        thread.conversationId,
        status ?? thread.status,
        thread.title,
      );
    } catch (error) {
      logger.warn('[projects/threads] Could not mirror thread status onto its chat', error);
    }
  };

  async function startThread(input: StartProjectThreadInput): Promise<IProjectThread> {
    const config = getThreadsConfig(await deps.getConfig());
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    const brief = input.brief.trim();
    if (!title) {
      throw new ProjectThreadError('A thread needs a title.');
    }
    if (!brief) {
      throw new ProjectThreadError('A thread needs a brief: the whole task, self-contained.');
    }
    if (brief.length > config.briefMaxChars) {
      throw new ProjectThreadError(
        `The brief is too long (${brief.length} characters, at most ${config.briefMaxChars}).`,
      );
    }
    const thread = await methods.createProjectThread({
      user: input.userId,
      ...(input.tenantId != null && { tenantId: input.tenantId }),
      projectId: input.projectId,
      conversationId: randomUUID(),
      coordinatorConversationId: input.coordinatorConversationId ?? null,
      agentId: input.agentId,
      title,
      brief,
      input: renderThreadBrief(title, brief),
    });
    void notify(thread);
    pump();
    return thread;
  }

  async function postToThread({
    userId,
    projectId,
    threadId,
    text,
  }: {
    userId: string;
    projectId: string;
    threadId: string;
    text: string;
  }): Promise<IProjectThread> {
    const config = getThreadsConfig(await deps.getConfig());
    const message = text.trim();
    if (!message) {
      throw new ProjectThreadError('The message is empty.');
    }
    if (message.length > config.briefMaxChars) {
      throw new ProjectThreadError(`The message is too long (at most ${config.briefMaxChars}).`);
    }
    const thread = await methods.getProjectThread(userId, threadId);
    if (!thread || thread.projectId !== projectId) {
      throw new ProjectThreadError('No thread with that id in this project.');
    }
    if (thread.status === 'needs_you') {
      throw new ProjectThreadError(
        'That thread is waiting for the user (an approval or a question). Ask the user to open it.',
      );
    }
    const queued = await methods.queueProjectThreadInput(userId, threadId, message);
    if (!queued) {
      throw new ProjectThreadError('The thread changed while posting; try again.');
    }
    if (queued.run === 'queued') {
      await mirror(queued, 'working');
      void notify(queued);
    }
    pump();
    return queued;
  }

  async function listThreads(userId: string, projectId: string): Promise<IProjectThread[]> {
    return await methods.listProjectThreads(userId, projectId);
  }

  async function getThread(
    userId: string,
    projectId: string,
    threadId: string,
  ): Promise<IProjectThread | null> {
    const thread = await methods.getProjectThread(userId, threadId);
    return thread && thread.projectId === projectId ? thread : null;
  }

  async function buildEnvelope(
    thread: IProjectThread,
    input: string,
    firstRun: boolean,
  ): Promise<AgentTriggerEnvelope> {
    const principal = await deps.getPrincipal(thread.user);
    if (!principal) {
      throw new ProjectThreadError('The thread owner no longer exists.');
    }
    const id = thread._id?.toString() ?? '';
    const deliveryId = `${PROJECT_THREAD_SOURCE}:${id}:${thread.runCount}`;
    const event = {
      id: deliveryId,
      type: PROJECT_THREAD_EVENT_TYPE,
      occurredAt: now(),
      source: { id, type: PROJECT_THREAD_SOURCE },
    };
    const base = {
      requestId: randomUUID(),
      deliveryId,
      receivedAt: now(),
      principal,
      event,
      input,
    };
    const parent = firstRun
      ? undefined
      : findLast(await deps.getMessages(thread.user, thread.conversationId));
    if (!parent) {
      return createAgentTriggerEnvelope({
        ...base,
        mode: 'fire',
        target: { agentId: thread.agentId },
        run: {
          conversationId: thread.conversationId,
          chatProjectId: thread.projectId,
          metadata: { projectThreadId: id },
        },
      });
    }
    return createAgentTriggerEnvelope({
      ...base,
      mode: 'continue',
      target: {
        agentId: thread.agentId,
        conversationId: thread.conversationId,
        parentMessageId: parent.messageId,
      },
    });
  }

  async function dispatchNext(): Promise<boolean> {
    const config = getThreadsConfig(await deps.getConfig());
    const running = await methods.countRunningProjectThreads();
    if (running >= config.concurrency) {
      return false;
    }
    const generations = await deps.getRunningGenerationCount();
    if (generations > running) {
      return false;
    }
    const claimed = await methods.claimNextQueuedProjectThread();
    if (!claimed) {
      return false;
    }
    const { thread, input, firstRun } = claimed;
    try {
      const envelope = await buildEnvelope(thread, input, firstRun);
      await deps.enqueueTrigger(envelope, {
        orderingKey: `${PROJECT_THREAD_SOURCE}:${thread._id?.toString()}`,
      });
      logger.info(`[projects/threads] Started run ${thread.runCount} of "${thread.title}"`);
    } catch (error) {
      logger.error('[projects/threads] Could not start a thread run', error);
      const failed = await methods.finishProjectThread(thread._id?.toString() ?? '', {
        status: 'failed',
        error: `Could not start: ${errorText(error)}`,
      });
      await mirror(failed);
      await notify(failed);
    }
    return true;
  }

  /** Starts queued runs while the slot is free. Single-flight; a call during a pass reruns it. */
  function pump(): Promise<void> {
    if (pumping) {
      pumpAgain = true;
      return pumping;
    }
    pumping = (async () => {
      try {
        do {
          pumpAgain = false;
          while (await dispatchNext()) {
            /* keep filling free slots */
          }
        } while (pumpAgain);
      } catch (error) {
        logger.error('[projects/threads] Queue pass failed', error);
      } finally {
        pumping = null;
      }
    })();
    return pumping;
  }

  async function summarize(thread: IProjectThread, reply: string): Promise<string> {
    const config = getThreadsConfig(await deps.getConfig());
    const request = {
      title: thread.title,
      brief: thread.brief,
      reply,
      maxTokens: config.summaryMaxTokens,
    };
    if (!deps.createSummarizer) {
      return fallbackSummary(request);
    }
    return await deps.createSummarizer(thread.agentId)(request);
  }

  /** Finishes a thread whose generation ended. Safe to call twice: only one call settles. */
  async function handleSettled({
    userId,
    conversationId,
    status,
  }: {
    userId: string;
    conversationId: string;
    status: 'complete' | 'error' | 'aborted';
  }): Promise<void> {
    const thread = await methods.beginProjectThreadSettle(userId, conversationId);
    if (!thread) {
      return;
    }
    const id = thread._id?.toString() ?? '';
    try {
      if (thread.pendingInput && status === 'complete') {
        const requeued = await methods.requeueProjectThread(id);
        await mirror(requeued, 'working');
        return;
      }
      const messages = await deps.getMessages(userId, conversationId);
      const final = findFinalReply(messages);
      const reply = final ? extractMessageText(final) : '';
      let finished: IProjectThread | null;
      if (status === 'complete' && final && final.error !== true && reply) {
        finished = await methods.finishProjectThread(id, {
          status: 'done',
          summary: await summarize(thread, reply),
        });
      } else {
        finished = await methods.finishProjectThread(id, {
          status: 'failed',
          error: failureReason(status, final, reply),
        });
      }
      await mirror(finished);
      await notify(finished);
    } catch (error) {
      logger.error('[projects/threads] Could not finish a thread', error);
      const failed = await methods.finishProjectThread(id, {
        status: 'failed',
        error: `Could not finish: ${errorText(error)}`,
      });
      await mirror(failed);
    }
  }

  /** Generation-settled listener: finish the thread, then let the next one run. */
  function onGenerationSettled(event: {
    userId: string;
    conversationId: string;
    status: 'complete' | 'error' | 'aborted';
  }): void {
    void handleSettled(event)
      .catch((error) => logger.error('[projects/threads] Settle failed', error))
      .finally(() => pump());
  }

  async function checkDispatched(thread: IProjectThread): Promise<void> {
    const id = thread._id?.toString() ?? '';
    const status = await deps.getGenerationStatus(thread.conversationId);
    if (status === 'running' || status === 'requires_action') {
      const next = status === 'running' ? 'working' : 'needs_you';
      const changed = await methods.setDispatchedProjectThreadStatus(id, next);
      const runKey = `${id}:${thread.runCount}:${next}`;
      if (changed || !mirroredRuns.has(runKey)) {
        mirroredRuns.add(runKey);
        await mirror(changed ?? thread, next);
      }
      if (changed) {
        await notify(changed);
      }
      return;
    }
    if (status === 'complete' || status === 'error' || status === 'aborted') {
      await handleSettled({ userId: thread.user, conversationId: thread.conversationId, status });
      return;
    }
    const age = now() - new Date(thread.dispatchedAt ?? 0).getTime();
    if (age < ADMISSION_GRACE_MS) {
      return;
    }
    const final = findFinalReply(await deps.getMessages(thread.user, thread.conversationId));
    const repliedAfterDispatch =
      final?.createdAt != null &&
      new Date(final.createdAt).getTime() >= new Date(thread.dispatchedAt ?? 0).getTime();
    if (repliedAfterDispatch) {
      await handleSettled({
        userId: thread.user,
        conversationId: thread.conversationId,
        status: final?.error === true ? 'error' : 'complete',
      });
      return;
    }
    if (age >= LOST_AFTER_MS) {
      await handleSettled({
        userId: thread.user,
        conversationId: thread.conversationId,
        status: 'error',
      });
    }
  }

  /** Reconciles dispatched threads with their generations (pauses, missed or lost runs). */
  async function sweep(): Promise<void> {
    try {
      const dispatched = await methods.listDispatchedProjectThreads();
      for (const thread of dispatched) {
        await checkDispatched(thread).catch((error) =>
          logger.warn('[projects/threads] Sweep could not check a thread', error),
        );
      }
    } catch (error) {
      logger.error('[projects/threads] Sweep failed', error);
    }
    await pump();
  }

  function start(intervalMs = SWEEP_INTERVAL_MS): void {
    if (timer) {
      return;
    }
    timer = setInterval(() => void sweep(), intervalMs);
    timer.unref?.();
    void sweep();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    startThread,
    postToThread,
    listThreads,
    getThread,
    pump,
    sweep,
    handleSettled,
    onGenerationSettled,
    start,
    stop,
  };
}

function failureReason(
  status: 'complete' | 'error' | 'aborted',
  final: ThreadMessage | undefined,
  reply: string,
): string {
  if (status === 'aborted') {
    return 'Stopped before it finished.';
  }
  if (final?.error === true && reply) {
    return reply.slice(0, 500);
  }
  return 'The run ended without an answer.';
}

function findLast(messages: ThreadMessage[]): ThreadMessage | undefined {
  return messages.length > 0 ? messages[messages.length - 1] : undefined;
}
