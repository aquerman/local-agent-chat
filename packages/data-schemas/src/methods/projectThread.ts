import type { Model } from 'mongoose';
import type {
  IConversation,
  IProjectThread,
  ProjectThreadStatus,
  IProjectThreadDocument,
} from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';

export type CreateProjectThreadInput = {
  user: string;
  tenantId?: string;
  projectId: string;
  conversationId: string;
  coordinatorConversationId?: string | null;
  agentId: string;
  title: string;
  brief: string;
  /** The first run's message: the brief as the thread will read it. */
  input: string;
};

/** A chat the user started in a project themselves, recorded as a thread after its first turn. */
export type AdoptProjectThreadInput = Omit<CreateProjectThreadInput, 'input'>;

/** A thread claimed for one run, with the input that run sends. */
export type ClaimedProjectThread = {
  thread: IProjectThread;
  input: string;
  /** True for the run that creates the thread's chat. */
  firstRun: boolean;
};

export type FinishProjectThreadInput = {
  status: Extract<ProjectThreadStatus, 'done' | 'failed'>;
  summary?: string;
  error?: string;
};

export interface ProjectThreadMethods {
  createProjectThread(input: CreateProjectThreadInput): Promise<IProjectThread>;
  getProjectThread(user: string, threadId: string): Promise<IProjectThread | null>;
  /** Records a user-started project chat as an idle thread; returns the existing one if any. */
  adoptProjectThread(input: AdoptProjectThreadInput): Promise<IProjectThread | null>;
  getProjectThreadByConversation(
    user: string,
    conversationId: string,
  ): Promise<IProjectThread | null>;
  listProjectThreads(user: string, projectId: string, limit?: number): Promise<IProjectThread[]>;
  /** Done and failed threads, most recently finished first: the coordinator's summary index. */
  listFinishedProjectThreads(
    user: string,
    projectId: string,
    limit: number,
  ): Promise<IProjectThread[]>;
  /** Threads holding a generation slot: dispatched and not paused on the user. */
  countRunningProjectThreads(): Promise<number>;
  listDispatchedProjectThreads(): Promise<IProjectThread[]>;
  /** Takes the oldest queued thread for one run. Atomic, so two pumps never start the same run. */
  claimNextQueuedProjectThread(): Promise<ClaimedProjectThread | null>;
  /** Adds a message for the thread's next run and queues it unless it is running now. */
  queueProjectThreadInput(
    user: string,
    threadId: string,
    text: string,
  ): Promise<IProjectThread | null>;
  /** Fences settlement: only one caller moves a dispatched thread to `settling`. */
  beginProjectThreadSettle(user: string, conversationId: string): Promise<IProjectThread | null>;
  /** Puts a settling thread back in the queue because a message arrived while it ran. */
  requeueProjectThread(threadId: string): Promise<IProjectThread | null>;
  finishProjectThread(
    threadId: string,
    input: FinishProjectThreadInput,
  ): Promise<IProjectThread | null>;
  /**
   * Records a new hand-back after the user talked to an idle thread directly: the thread counts
   * as done with this summary. Null when the thread is queued or running again.
   */
  updateIdleProjectThreadSummary(threadId: string, summary: string): Promise<IProjectThread | null>;
  /** Moves a dispatched thread between working and needs_you; null when nothing changed. */
  setDispatchedProjectThreadStatus(
    threadId: string,
    status: Extract<ProjectThreadStatus, 'working' | 'needs_you'>,
  ): Promise<IProjectThread | null>;
  /** Mirrors a thread's status (and title) onto its chat for the conversation list. */
  setConversationThreadStatus(
    user: string,
    conversationId: string,
    status: ProjectThreadStatus,
    title?: string,
  ): Promise<boolean>;
  deleteProjectThreadsForProject(user: string, projectId: string): Promise<number>;
}

const FINISHED: ProjectThreadStatus[] = ['done', 'failed'];

export function createProjectThreadMethods(
  mongoose: typeof import('mongoose'),
): ProjectThreadMethods {
  const model = () => mongoose.models.ProjectThread as Model<IProjectThreadDocument>;

  async function createProjectThread(input: CreateProjectThreadInput): Promise<IProjectThread> {
    const now = new Date();
    const doc = await model().create({
      user: input.user,
      ...(input.tenantId != null && { tenantId: input.tenantId }),
      projectId: input.projectId,
      conversationId: input.conversationId,
      coordinatorConversationId: input.coordinatorConversationId ?? null,
      agentId: input.agentId,
      title: input.title,
      brief: input.brief,
      status: 'working',
      run: 'queued',
      runCount: 0,
      pendingInput: input.input,
      queuedAt: now,
    });
    return doc.toObject() as IProjectThread;
  }

  async function getProjectThread(user: string, threadId: string): Promise<IProjectThread | null> {
    if (!isValidObjectIdString(threadId)) {
      return null;
    }
    return await model()
      .findOne({ _id: new mongoose.Types.ObjectId(threadId), user })
      .lean<IProjectThread>();
  }

  async function adoptProjectThread(
    input: AdoptProjectThreadInput,
  ): Promise<IProjectThread | null> {
    return await model()
      .findOneAndUpdate(
        { user: input.user, conversationId: input.conversationId },
        {
          $setOnInsert: {
            user: input.user,
            ...(input.tenantId != null && { tenantId: input.tenantId }),
            projectId: input.projectId,
            conversationId: input.conversationId,
            coordinatorConversationId: input.coordinatorConversationId ?? null,
            agentId: input.agentId,
            title: input.title,
            brief: input.brief,
            status: 'done',
            run: 'idle',
            runCount: 0,
          },
        },
        { upsert: true, new: true },
      )
      .lean<IProjectThread>();
  }

  async function getProjectThreadByConversation(
    user: string,
    conversationId: string,
  ): Promise<IProjectThread | null> {
    return await model().findOne({ user, conversationId }).lean<IProjectThread>();
  }

  async function listProjectThreads(
    user: string,
    projectId: string,
    limit = 50,
  ): Promise<IProjectThread[]> {
    return await model()
      .find({ user, projectId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<IProjectThread[]>();
  }

  async function listFinishedProjectThreads(
    user: string,
    projectId: string,
    limit: number,
  ): Promise<IProjectThread[]> {
    if (limit <= 0) {
      return [];
    }
    return await model()
      .find({ user, projectId, status: { $in: FINISHED } })
      .sort({ finishedAt: -1, _id: -1 })
      .limit(limit)
      .lean<IProjectThread[]>();
  }

  async function countRunningProjectThreads(): Promise<number> {
    return await model().countDocuments({
      run: { $in: ['dispatched', 'settling'] },
      status: 'working',
    });
  }

  async function listDispatchedProjectThreads(): Promise<IProjectThread[]> {
    return await model()
      .find({ run: 'dispatched' })
      .sort({ dispatchedAt: 1 })
      .limit(100)
      .lean<IProjectThread[]>();
  }

  async function claimNextQueuedProjectThread(): Promise<ClaimedProjectThread | null> {
    const before = await model()
      .findOneAndUpdate(
        { run: 'queued' },
        {
          $set: {
            run: 'dispatched',
            status: 'working',
            dispatchedAt: new Date(),
            pendingInput: null,
          },
          $inc: { runCount: 1 },
        },
        { sort: { queuedAt: 1, _id: 1 }, new: false },
      )
      .lean<IProjectThread>();
    if (!before) {
      return null;
    }
    return {
      thread: {
        ...before,
        run: 'dispatched',
        status: 'working',
        runCount: before.runCount + 1,
        pendingInput: null,
      },
      input: before.pendingInput ?? '',
      firstRun: before.runCount === 0,
    };
  }

  async function queueProjectThreadInput(
    user: string,
    threadId: string,
    text: string,
  ): Promise<IProjectThread | null> {
    const existing = await getProjectThread(user, threadId);
    if (!existing) {
      return null;
    }
    const pendingInput = existing.pendingInput ? `${existing.pendingInput}\n\n${text}` : text;
    const idle = existing.run === 'idle';
    return await model()
      .findOneAndUpdate(
        { _id: existing._id, user, run: existing.run },
        {
          $set: {
            pendingInput,
            ...(idle && { run: 'queued', status: 'working', queuedAt: new Date() }),
          },
        },
        { new: true },
      )
      .lean<IProjectThread>();
  }

  async function beginProjectThreadSettle(
    user: string,
    conversationId: string,
  ): Promise<IProjectThread | null> {
    return await model()
      .findOneAndUpdate(
        { user, conversationId, run: 'dispatched' },
        { $set: { run: 'settling' } },
        { new: true },
      )
      .lean<IProjectThread>();
  }

  async function requeueProjectThread(threadId: string): Promise<IProjectThread | null> {
    return await model()
      .findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(threadId), run: 'settling' },
        { $set: { run: 'queued', status: 'working', queuedAt: new Date() } },
        { new: true },
      )
      .lean<IProjectThread>();
  }

  async function finishProjectThread(
    threadId: string,
    input: FinishProjectThreadInput,
  ): Promise<IProjectThread | null> {
    return await model()
      .findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(threadId), run: { $in: ['settling', 'dispatched'] } },
        {
          $set: {
            run: 'idle',
            status: input.status,
            finishedAt: new Date(),
            ...(input.summary != null && { summary: input.summary }),
            error: input.error ?? '',
          },
        },
        { new: true },
      )
      .lean<IProjectThread>();
  }

  async function updateIdleProjectThreadSummary(
    threadId: string,
    summary: string,
  ): Promise<IProjectThread | null> {
    if (!isValidObjectIdString(threadId)) {
      return null;
    }
    return await model()
      .findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(threadId), run: 'idle' },
        { $set: { status: 'done', summary, error: '', finishedAt: new Date() } },
        { new: true },
      )
      .lean<IProjectThread>();
  }

  async function setDispatchedProjectThreadStatus(
    threadId: string,
    status: Extract<ProjectThreadStatus, 'working' | 'needs_you'>,
  ): Promise<IProjectThread | null> {
    return await model()
      .findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(threadId),
          run: 'dispatched',
          status: { $ne: status },
        },
        { $set: { status } },
        { new: true },
      )
      .lean<IProjectThread>();
  }

  async function setConversationThreadStatus(
    user: string,
    conversationId: string,
    status: ProjectThreadStatus,
    title?: string,
  ): Promise<boolean> {
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const result = await Conversation.updateOne(
      { user, conversationId },
      { $set: { threadStatus: status, ...(title ? { title } : {}) } },
      { timestamps: false },
    );
    return result.matchedCount > 0;
  }

  async function deleteProjectThreadsForProject(user: string, projectId: string): Promise<number> {
    const result = await model().deleteMany({ user, projectId });
    return result.deletedCount ?? 0;
  }

  return {
    createProjectThread,
    getProjectThread,
    adoptProjectThread,
    getProjectThreadByConversation,
    listProjectThreads,
    listFinishedProjectThreads,
    countRunningProjectThreads,
    listDispatchedProjectThreads,
    claimNextQueuedProjectThread,
    queueProjectThreadInput,
    beginProjectThreadSettle,
    requeueProjectThread,
    finishProjectThread,
    updateIdleProjectThreadSummary,
    setDispatchedProjectThreadStatus,
    setConversationThreadStatus,
    deleteProjectThreadsForProject,
  };
}
