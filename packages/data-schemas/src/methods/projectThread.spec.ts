import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IConversation } from '~/types';
import { createProjectThreadMethods, type ProjectThreadMethods } from './projectThread';
import { createChatProjectMethods, type ChatProjectMethods } from './chatProject';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let threads: ProjectThreadMethods;
let projects: ChatProjectMethods;
let modelsToCleanup: string[] = [];

const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  modelsToCleanup = Object.keys(models);
  Object.assign(mongoose.models, models);
  threads = createProjectThreadMethods(mongoose);
  projects = createChatProjectMethods(mongoose);
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
  await mongoose.models.ProjectThread.deleteMany({});
  await mongoose.models.ChatProject.deleteMany({});
  await mongoose.models.Conversation.deleteMany({});
});

const createThread = (
  overrides: { title?: string; conversationId?: string; owner?: string } = {},
) =>
  threads.createProjectThread({
    user: overrides.owner ?? user,
    projectId: 'p1',
    conversationId: overrides.conversationId ?? `c-${Math.random().toString(36).slice(2)}`,
    coordinatorConversationId: 'coord',
    agentId: 'agent_benny',
    title: overrides.title ?? 'Research',
    brief: 'Find three facts.',
    input: 'Task: Research\n\nFind three facts.',
  });

describe('project thread queue', () => {
  it('creates a queued working thread carrying its first input', async () => {
    const thread = await createThread();
    expect(thread.status).toBe('working');
    expect(thread.run).toBe('queued');
    expect(thread.pendingInput).toContain('Find three facts.');
  });

  it('claims the oldest queued thread once, with its input and first-run flag', async () => {
    const first = await createThread({ title: 'First' });
    await createThread({ title: 'Second' });

    const claimed = await threads.claimNextQueuedProjectThread();
    expect(claimed?.thread.title).toBe('First');
    expect(claimed?.firstRun).toBe(true);
    expect(claimed?.input).toContain('Find three facts.');

    const stored = await threads.getProjectThread(user, first._id!.toString());
    expect(stored?.run).toBe('dispatched');
    expect(stored?.pendingInput).toBeNull();
    expect(stored?.runCount).toBe(1);
    expect(await threads.countRunningProjectThreads()).toBe(1);

    const next = await threads.claimNextQueuedProjectThread();
    expect(next?.thread.title).toBe('Second');
    expect(await threads.claimNextQueuedProjectThread()).toBeNull();
  });

  it('lets only one caller settle a dispatched thread', async () => {
    const thread = await createThread({ conversationId: 'c-settle' });
    await threads.claimNextQueuedProjectThread();

    const [a, b] = await Promise.all([
      threads.beginProjectThreadSettle(user, 'c-settle'),
      threads.beginProjectThreadSettle(user, 'c-settle'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const done = await threads.finishProjectThread(thread._id!.toString(), {
      status: 'done',
      summary: 'Three facts found.',
    });
    expect(done?.status).toBe('done');
    expect(done?.run).toBe('idle');
    expect(done?.finishedAt).toBeInstanceOf(Date);
  });

  it('queues a follow-up on an idle thread and holds it for a running one', async () => {
    const thread = await createThread({ conversationId: 'c-follow' });
    const id = thread._id!.toString();
    await threads.claimNextQueuedProjectThread();

    const whileRunning = await threads.queueProjectThreadInput(user, id, 'Also add sources.');
    expect(whileRunning?.run).toBe('dispatched');
    expect(whileRunning?.pendingInput).toBe('Also add sources.');

    await threads.beginProjectThreadSettle(user, 'c-follow');
    const requeued = await threads.requeueProjectThread(id);
    expect(requeued?.run).toBe('queued');

    const claimed = await threads.claimNextQueuedProjectThread();
    expect(claimed?.firstRun).toBe(false);
    expect(claimed?.input).toBe('Also add sources.');
    await threads.beginProjectThreadSettle(user, 'c-follow');
    await threads.finishProjectThread(id, { status: 'done', summary: 'ok' });

    const reopened = await threads.queueProjectThreadInput(user, id, 'One more thing.');
    expect(reopened?.run).toBe('queued');
    expect(reopened?.status).toBe('working');
  });

  it('toggles needs_you only on a dispatched thread', async () => {
    const thread = await createThread();
    const id = thread._id!.toString();
    expect(await threads.setDispatchedProjectThreadStatus(id, 'needs_you')).toBeNull();
    await threads.claimNextQueuedProjectThread();
    expect((await threads.setDispatchedProjectThreadStatus(id, 'needs_you'))?.status).toBe(
      'needs_you',
    );
    expect(await threads.setDispatchedProjectThreadStatus(id, 'needs_you')).toBeNull();
    expect(await threads.countRunningProjectThreads()).toBe(0);
  });

  it('scopes reads to the owner and lists finished threads newest first', async () => {
    const a = await createThread({ title: 'A' });
    const b = await createThread({ title: 'B' });
    await createThread({ title: 'Other', owner: otherUser });
    await createThread({ title: 'Still running' });

    for (const thread of [a, b]) {
      await mongoose.models.ProjectThread.updateOne({ _id: thread._id }, { run: 'settling' });
      await threads.finishProjectThread(thread._id!.toString(), { status: 'done', summary: 's' });
    }

    expect(await threads.getProjectThread(otherUser, a._id!.toString())).toBeNull();
    expect((await threads.listProjectThreads(user, 'p1')).map((t) => t.title)).toHaveLength(3);
    const finished = await threads.listFinishedProjectThreads(user, 'p1', 10);
    expect(finished.map((t) => t.title)).toEqual(['B', 'A']);
    expect(await threads.listFinishedProjectThreads(user, 'p1', 0)).toEqual([]);
  });

  it('mirrors status and title onto the thread chat', async () => {
    const Conversation = mongoose.models.Conversation as mongoose.Model<IConversation>;
    await Conversation.create({
      user,
      conversationId: 'c-mirror',
      title: 'New Chat',
      endpoint: 'agents',
    });
    expect(await threads.setConversationThreadStatus(user, 'c-mirror', 'done', 'Research')).toBe(
      true,
    );
    const convo = await Conversation.findOne({ conversationId: 'c-mirror' }).lean();
    expect(convo?.threadStatus).toBe('done');
    expect(convo?.title).toBe('Research');
    expect(await threads.setConversationThreadStatus(otherUser, 'c-mirror', 'failed')).toBe(false);
  });
});

describe('project coordinator', () => {
  it('claims the coordinator once and keeps the first chat', async () => {
    const project = await projects.createChatProject(user, { name: 'Trip' });
    const id = project._id!.toString();
    expect(await projects.claimChatProjectCoordinator(user, id, 'chat-1')).toBe('chat-1');
    expect(await projects.claimChatProjectCoordinator(user, id, 'chat-2')).toBe('chat-1');
    expect(await projects.claimChatProjectCoordinator(otherUser, id, 'chat-3')).toBeNull();
    expect(await projects.claimChatProjectCoordinator(user, id, 'chat-4', 'chat-1')).toBe('chat-4');
  });

  it('deletes a project with its threads and clears thread badges', async () => {
    const project = await projects.createChatProject(user, { name: 'Trip' });
    const id = project._id!.toString();
    const Conversation = mongoose.models.Conversation as mongoose.Model<IConversation>;
    await Conversation.create({
      user,
      conversationId: 'c-del',
      endpoint: 'agents',
      chatProjectId: id,
      threadStatus: 'done',
    });
    await threads.createProjectThread({
      user,
      projectId: id,
      conversationId: 'c-del',
      agentId: 'a',
      title: 'T',
      brief: 'b',
      input: 'b',
    });

    await projects.deleteChatProject(user, id);
    expect(await mongoose.models.ProjectThread.countDocuments({})).toBe(0);
    const convo = await Conversation.findOne({ conversationId: 'c-del' }).lean();
    expect(convo?.threadStatus).toBeUndefined();
    expect(convo?.chatProjectId ?? null).toBeNull();
  });
});
