import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AgentTriggerEnvelope } from '~/agents/triggers/envelope';
import type { ProjectContextDependencies } from '../context';
import type { ProjectThreadServiceDeps } from './service';
import type { ThreadMessage } from './summary';
import {
  renderThreadBrief,
  ProjectThreadError,
  PROJECT_THREAD_SOURCE,
  createProjectThreadService,
} from './service';
import {
  clampToTokens,
  extractMessageText,
  createThreadSummarizer,
  resolveCustomSummaryEndpoint,
} from './summary';
import { buildCoordinatorBlock, resolveProjectRunContext } from '../context';
import { createProjectThreadTools, resolveCoordinatorTools } from './tools';
import { isProjectThreadFireRequest } from './trigger';

let mongoServer: MongoMemoryServer;
let db: ReturnType<typeof createMethods>;

const userId = new mongoose.Types.ObjectId().toString();

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
  await mongoose.models.ProjectThread.deleteMany({});
  await mongoose.models.ChatProject.deleteMany({});
  await mongoose.models.Conversation.deleteMany({});
});

/** A stand-in for the generation runtime: what the trigger queue and job store would report. */
function createHarness(overrides: Partial<ProjectThreadServiceDeps> = {}) {
  const enqueued: AgentTriggerEnvelope[] = [];
  const jobs = new Map<string, 'running' | 'complete' | 'error' | 'aborted' | 'requires_action'>();
  const messages = new Map<string, ThreadMessage[]>();
  let liveChats = 0;
  const changes: string[] = [];
  const deps: ProjectThreadServiceDeps = {
    methods: db,
    getMessages: async (_user, conversationId) => messages.get(conversationId) ?? [],
    enqueueTrigger: async (envelope) => {
      enqueued.push(envelope);
    },
    getGenerationStatus: async (conversationId) => jobs.get(conversationId),
    getRunningGenerationCount: async () =>
      liveChats + [...jobs.values()].filter((status) => status === 'running').length,
    getPrincipal: async (id) => ({ id }),
    getConfig: async () => ({ concurrency: 1, summaryMaxTokens: 20 }),
    createSummarizer:
      () =>
      async ({ reply }) =>
        `Summary: ${reply.slice(0, 40)}`,
    onStatusChange: (thread) => {
      changes.push(`${thread.title}:${thread.status}`);
    },
    ...overrides,
  };
  const service = createProjectThreadService(deps);
  return {
    service,
    enqueued,
    jobs,
    messages,
    changes,
    setLiveChats: (count: number) => {
      liveChats = count;
    },
  };
}

const start = (
  harness: ReturnType<typeof createHarness>,
  title = 'Find flights',
  projectId = 'p1',
) =>
  harness.service.startThread({
    userId,
    projectId,
    coordinatorConversationId: 'coord',
    agentId: 'agent_benny',
    title,
    brief: 'Find the cheapest flight from Amsterdam to Lisbon in May.',
  });

const reply = (text: string, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({
  messageId: `m-${Math.random()}`,
  isCreatedByUser: false,
  content: [
    { type: 'think', think: 'hidden' },
    { type: 'text', text },
  ],
  createdAt: new Date(),
  ...extra,
});

describe('project thread service', () => {
  it('fires a new chat in the project with the self-contained brief', async () => {
    const harness = createHarness();
    const thread = await start(harness);
    await harness.service.pump();

    expect(harness.enqueued).toHaveLength(1);
    const envelope = harness.enqueued[0];
    expect(envelope.mode).toBe('fire');
    if (envelope.mode !== 'fire') return;
    expect(envelope.target.agentId).toBe('agent_benny');
    expect(envelope.event.source).toEqual({
      id: thread._id!.toString(),
      type: PROJECT_THREAD_SOURCE,
    });
    expect(envelope.run?.conversationId).toBe(thread.conversationId);
    expect(envelope.run?.chatProjectId).toBe('p1');
    expect(envelope.input).toBe(renderThreadBrief('Find flights', thread.brief));
    expect(envelope.input).toContain('Amsterdam to Lisbon');
  });

  it('waits behind live chat and runs one thread at a time', async () => {
    const harness = createHarness();
    harness.setLiveChats(1);
    const first = await start(harness, 'First');
    await start(harness, 'Second');
    await harness.service.pump();
    expect(harness.enqueued).toHaveLength(0);

    harness.setLiveChats(0);
    await harness.service.pump();
    expect(harness.enqueued).toHaveLength(1);
    expect(harness.enqueued[0].event.source.id).toBe(first._id!.toString());

    harness.jobs.set(first.conversationId, 'running');
    await harness.service.pump();
    expect(harness.enqueued).toHaveLength(1);
  });

  it('finishes with a summary, mirrors the status and starts the next thread', async () => {
    const harness = createHarness();
    const first = await start(harness, 'First');
    await start(harness, 'Second');
    await harness.service.pump();
    await mongoose.models.Conversation.create({
      user: userId,
      conversationId: first.conversationId,
      endpoint: 'agents',
      title: 'New Chat',
    });
    harness.messages.set(first.conversationId, [reply('KLM at 89 euros on 12 May.')]);

    await harness.service.handleSettled({
      userId,
      conversationId: first.conversationId,
      status: 'complete',
    });
    await harness.service.pump();

    const done = await db.getProjectThread(userId, first._id!.toString());
    expect(done?.status).toBe('done');
    expect(done?.summary).toBe('Summary: KLM at 89 euros on 12 May.');
    const convo = await mongoose.models.Conversation.findOne({
      conversationId: first.conversationId,
    }).lean<{ threadStatus?: string; title?: string }>();
    expect(convo?.threadStatus).toBe('done');
    expect(convo?.title).toBe('First');
    expect(harness.changes).toContain('First:done');
    expect(harness.enqueued).toHaveLength(2);

    await harness.service.handleSettled({
      userId,
      conversationId: first.conversationId,
      status: 'complete',
    });
    expect(harness.enqueued).toHaveLength(2);
  });

  it('marks errors and stops as failed', async () => {
    const harness = createHarness();
    const thread = await start(harness);
    await harness.service.pump();
    harness.messages.set(thread.conversationId, [
      reply('Model server unreachable', { error: true }),
    ]);
    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });
    const failed = await db.getProjectThread(userId, thread._id!.toString());
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('Model server unreachable');

    const stopped = await start(harness, 'Stopped');
    await harness.service.pump();
    await harness.service.handleSettled({
      userId,
      conversationId: stopped.conversationId,
      status: 'aborted',
    });
    expect((await db.getProjectThread(userId, stopped._id!.toString()))?.error).toMatch(/Stopped/);
  });

  it('marks a run paused for approval as needs_you, and back when it resumes', async () => {
    const harness = createHarness();
    const thread = await start(harness);
    await harness.service.pump();
    harness.jobs.set(thread.conversationId, 'requires_action');
    await harness.service.sweep();
    expect((await db.getProjectThread(userId, thread._id!.toString()))?.status).toBe('needs_you');
    expect(harness.changes).toContain('Find flights:needs_you');

    await expect(
      harness.service.postToThread({
        userId,
        projectId: 'p1',
        threadId: thread._id!.toString(),
        text: 'hurry',
      }),
    ).rejects.toThrow(ProjectThreadError);

    harness.jobs.set(thread.conversationId, 'running');
    await harness.service.sweep();
    expect((await db.getProjectThread(userId, thread._id!.toString()))?.status).toBe('working');

    harness.jobs.set(thread.conversationId, 'complete');
    harness.messages.set(thread.conversationId, [reply('Booked nothing; options listed.')]);
    await harness.service.sweep();
    expect((await db.getProjectThread(userId, thread._id!.toString()))?.status).toBe('done');
  });

  it('continues a finished thread from its last message when the coordinator posts', async () => {
    const harness = createHarness();
    const thread = await start(harness);
    const id = thread._id!.toString();
    await harness.service.pump();
    const last = reply('Two options found.');
    harness.messages.set(thread.conversationId, [last]);
    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });

    await harness.service.postToThread({
      userId,
      projectId: 'p1',
      threadId: id,
      text: 'Add trains.',
    });
    await harness.service.pump();
    const envelope = harness.enqueued[1];
    expect(envelope.mode).toBe('continue');
    if (envelope.mode !== 'continue') return;
    expect(envelope.target.conversationId).toBe(thread.conversationId);
    expect(envelope.target.parentMessageId).toBe(last.messageId);
    expect(envelope.input).toBe('Add trains.');
    await expect(
      harness.service.postToThread({ userId, projectId: 'other', threadId: id, text: 'x' }),
    ).rejects.toThrow(/No thread/);
  });

  it('fails a thread whose run never started a generation', async () => {
    let clock = Date.now();
    const harness = createHarness({ now: () => clock });
    const thread = await start(harness);
    await harness.service.pump();
    clock += 31 * 60_000;
    await mongoose.models.ProjectThread.updateOne(
      { _id: thread._id },
      { dispatchedAt: new Date(Date.now() - 31 * 60_000) },
    );
    await harness.service.sweep();
    expect((await db.getProjectThread(userId, thread._id!.toString()))?.status).toBe('failed');
  });

  it('fails a thread when the trigger cannot be enqueued', async () => {
    const harness = createHarness({
      enqueueTrigger: async () => {
        throw new Error('queue down');
      },
    });
    const thread = await start(harness);
    await harness.service.pump();
    const failed = await db.getProjectThread(userId, thread._id!.toString());
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('queue down');
  });

  it('rejects empty and oversized briefs', async () => {
    const harness = createHarness({ getConfig: async () => ({ briefMaxChars: 200 }) });
    await expect(
      harness.service.startThread({
        userId,
        projectId: 'p1',
        agentId: 'a',
        title: 'x',
        brief: ' ',
      }),
    ).rejects.toThrow(/brief/);
    await expect(
      harness.service.startThread({
        userId,
        projectId: 'p1',
        agentId: 'a',
        title: 'x',
        brief: 'y'.repeat(201),
      }),
    ).rejects.toThrow(/too long/);
  });
});

describe('coordinator tools', () => {
  const context = {
    userId,
    projectId: 'p1',
    coordinatorConversationId: 'coord',
    agentId: 'agent_benny',
    briefMaxChars: 4000,
  };

  it('start, list, read and post through the tools', async () => {
    const harness = createHarness();
    const [startThread, listThreads, readSummary, postToThread] = createProjectThreadTools(
      context,
      harness.service,
    );
    expect(await listThreads.invoke({})).toBe('No threads in this project yet.');

    const started = JSON.parse(
      (await startThread.invoke({ title: 'Flights', brief: 'Find flights.' })) as string,
    );
    expect(started.status).toBe('working');
    const listed = JSON.parse((await listThreads.invoke({})) as string);
    expect(listed).toEqual([{ thread_id: started.thread_id, title: 'Flights', status: 'working' }]);

    const read = JSON.parse((await readSummary.invoke({ thread_id: started.thread_id })) as string);
    expect(read.note).toMatch(/Still working/);
    expect(await readSummary.invoke({ thread_id: 'nope' })).toMatch(/^Error/);
    expect(await postToThread.invoke({ thread_id: 'nope', text: 'x' })).toMatch(/^Error/);
    expect(await startThread.invoke({ title: 'Empty', brief: '   ' })).toMatch(/^Error/);
  });

  it('keeps every schema bound under llama.cpp grammar limits', () => {
    const tools = createProjectThreadTools(context, createHarness().service);
    const schemas = JSON.stringify(
      tools.map((t) => (t as unknown as { schema: { _def: unknown } }).schema._def),
    );
    const bounds = [...schemas.matchAll(/"value":(\d+)/g)].map((match) => Number(match[1]));
    expect(Math.max(0, ...bounds)).toBeLessThan(1000);
  });
});

describe('coordinator context', () => {
  const contextDeps = (): ProjectContextDependencies => ({
    getChatProject: db.getChatProject,
    listChatProjectKnowledge: db.listChatProjectKnowledge,
    getChatProjectKnowledgeText: db.getChatProjectKnowledgeText,
    claimChatProjectCoordinator: db.claimChatProjectCoordinator,
    getProjectThreadByConversation: db.getProjectThreadByConversation,
    listFinishedProjectThreads: db.listFinishedProjectThreads,
    conversationExists: async (user, conversationId) =>
      (await db.getConvo(user, conversationId)) != null,
  });

  const resolve = (projectId: string, conversationId: string, enabled = true) =>
    resolveProjectRunContext(
      {
        userId,
        projectId,
        inlineTokenBudget: 1000,
        retrievalAvailable: false,
        conversationId,
        threads: { enabled, indexLimit: 5 },
      },
      contextDeps(),
    );

  it('makes the first chat the coordinator and gives it the summary index after knowledge', async () => {
    const project = await db.createChatProject(userId, { name: 'Trip', instructions: 'Be brief.' });
    const projectId = project._id!.toString();
    await mongoose.models.Conversation.create({
      user: userId,
      conversationId: 'coord',
      endpoint: 'agents',
    });

    const first = await resolve(projectId, 'coord');
    expect(first?.role).toBe('coordinator');
    expect(first?.instructions).toContain("You are this project's coordinator.");
    expect(first?.instructions).not.toContain('<project_threads>');
    expect(first?.instructions.indexOf('<project_instructions>')).toBeLessThan(
      first?.instructions.indexOf('coordinator') ?? -1,
    );
    expect((await resolve(projectId, 'other'))?.role).toBe('chat');
    expect((await resolve(projectId, 'other'))?.instructions).not.toContain('coordinator');

    const harness = createHarness();
    const thread = await start(harness, 'Flights', projectId);
    expect((await resolve(projectId, thread.conversationId))?.role).toBe('thread');

    const running = await resolve(projectId, 'coord');
    expect(running?.instructions).toBe(first?.instructions);

    await harness.service.pump();
    harness.messages.set(thread.conversationId, [reply('KLM, 89 euros.')]);
    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });
    const after = await resolve(projectId, 'coord');
    expect(after?.instructions).toContain('<project_threads>');
    expect(after?.instructions).toContain('title="Flights" status="done"');
    expect(after?.instructions).toContain('Summary: KLM, 89 euros.');
    expect(after?.instructions).not.toContain('Amsterdam');
  });

  it('hands the coordinator role on when its chat is gone, and stays off when disabled', async () => {
    const project = await db.createChatProject(userId, { name: 'Trip' });
    const projectId = project._id!.toString();
    expect((await resolve(projectId, 'deleted-chat'))?.role).toBe('coordinator');
    expect((await resolve(projectId, 'new-chat'))?.role).toBe('coordinator');
    const other = await db.createChatProject(userId, { name: 'Plain' });
    const plain = await resolve(other._id!.toString(), 'c', false);
    expect(plain?.role).toBe('chat');
    expect(plain?.instructions).toBe('');
  });

  it('lists finished threads with id, title, status and summary only', () => {
    const block = buildCoordinatorBlock([
      { id: 't1', title: 'A "quoted"', status: 'failed', error: 'Stopped.' },
    ]);
    expect(block).toContain(
      '<thread id="t1" title="A  quoted" status="failed">\nStopped.\n</thread>',
    );
  });
});

describe('summary step', () => {
  it('reads only the visible text of a reply', () => {
    expect(extractMessageText(reply('Answer'))).toBe('Answer');
    expect(extractMessageText({ messageId: 'x', text: 'plain' })).toBe('plain');
  });

  it('calls the endpoint with thinking off and clamps the result', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '<think>x</think>Flights: KLM 89.' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const summarize = createThreadSummarizer({
      resolveEndpoint: async () => ({
        baseURL: 'http://127.0.0.1:8080/v1/',
        apiKey: 'local',
        model: 'local',
        llamaCpp: true,
      }),
      fetchImpl,
    });
    const summary = await summarize({
      title: 'F',
      brief: 'b',
      reply: 'long reply',
      maxTokens: 300,
    });
    expect(summary).toBe('Flights: KLM 89.');
    expect(calls[0].url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(calls[0].body.max_tokens).toBe(300);
  });

  it('falls back to the start of the reply when the call fails', async () => {
    const summarize = createThreadSummarizer({
      resolveEndpoint: async () => ({
        baseURL: 'http://x',
        apiKey: '',
        model: 'm',
        llamaCpp: false,
      }),
      fetchImpl: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
    });
    const summary = await summarize({
      title: 'F',
      brief: 'b',
      reply: 'word '.repeat(100),
      maxTokens: 10,
    });
    expect(summary.length).toBeLessThanOrEqual(41);
    expect(clampToTokens('short', 10)).toBe('short');
  });

  it('resolves a custom endpoint for the agent provider', () => {
    const endpoint = resolveCustomSummaryEndpoint(
      [
        {
          name: 'Benner',
          baseURL: 'http://127.0.0.1:8080/v1',
          apiKey: 'local',
          customParams: { reasoningFormat: 'llama_cpp_budget' },
        },
      ],
      { provider: 'Benner', model: 'local' },
    );
    expect(endpoint).toEqual({
      baseURL: 'http://127.0.0.1:8080/v1',
      apiKey: 'local',
      model: 'local',
      llamaCpp: true,
    });
    expect(resolveCustomSummaryEndpoint([], { provider: 'openAI', model: 'gpt' })).toBeNull();
  });
});

describe('isProjectThreadFireRequest', () => {
  const body = {
    agentTrigger: { version: 1, event: { source: { type: PROJECT_THREAD_SOURCE, id: 't1' } } },
  };
  it('accepts only trusted trigger requests', () => {
    expect(isProjectThreadFireRequest({ _isAgentTrigger: true, body })).toBe(true);
    expect(isProjectThreadFireRequest({ body })).toBe(false);
    expect(
      isProjectThreadFireRequest({
        _isAgentTrigger: true,
        body: { agentTrigger: { version: 1, event: { source: { type: 'schedule', id: 's' } } } },
      }),
    ).toBe(false);
  });
});

describe('resolveCoordinatorTools', () => {
  const base = {
    projectId: 'p1',
    userId,
    conversationId: 'coord',
    agentId: 'agent_x',
    agentIsEphemeral: false,
    threads: { enabled: true, agentId: 'agent_benny', briefMaxChars: 4000 },
  };

  it('gives the four tools only to the coordinator, on its own or the configured agent', () => {
    const getService = jest.fn(() => createHarness().service);
    const tools = resolveCoordinatorTools({ ...base, role: 'coordinator', getService });
    expect(tools?.map((t) => t.name)).toEqual([
      'start_thread',
      'list_threads',
      'read_summary',
      'post_to_thread',
    ]);
    expect(resolveCoordinatorTools({ ...base, role: 'thread', getService })).toBeUndefined();
    expect(resolveCoordinatorTools({ ...base, role: 'chat', getService })).toBeUndefined();
    expect(
      resolveCoordinatorTools({
        ...base,
        role: 'coordinator',
        threads: { ...base.threads, enabled: false },
        getService,
      }),
    ).toBeUndefined();
    expect(
      resolveCoordinatorTools({
        ...base,
        role: 'coordinator',
        agentIsEphemeral: true,
        threads: { enabled: true, briefMaxChars: 4000 },
        getService,
      }),
    ).toBeUndefined();
    expect(getService).toHaveBeenCalledTimes(1);
  });
});

describe('talking to a thread directly', () => {
  const later = (ms: number) => new Date(Date.now() + ms);
  const userMessage = (text: string, createdAt: Date): ThreadMessage => ({
    messageId: `u-${Math.random()}`,
    isCreatedByUser: true,
    text,
    createdAt,
  });

  function createUserTurnHarness(overrides: Partial<ProjectThreadServiceDeps> = {}) {
    const requests: Array<{ followUp?: string; previous?: string; brief: string }> = [];
    const harness = createHarness({
      getConfig: async () => ({
        enabled: true,
        agentId: 'agent_benny',
        concurrency: 1,
        summaryMaxTokens: 20,
        summarizeUserTurns: true,
      }),
      createSummarizer: () => async (request) => {
        requests.push(request);
        return `Summary: ${request.reply.slice(0, 40)}`;
      },
      ...overrides,
    });
    return { ...harness, requests };
  }

  it('rewrites the hand-back after the user prompts a finished thread', async () => {
    const harness = createUserTurnHarness();
    const thread = await start(harness);
    await harness.service.pump();
    await mongoose.models.Conversation.create({
      user: userId,
      conversationId: thread.conversationId,
      endpoint: 'agents',
      title: 'Find flights',
    });
    harness.messages.set(thread.conversationId, [reply('KLM at 89 euros on 12 May.')]);
    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });

    harness.messages.set(thread.conversationId, [
      reply('KLM at 89 euros on 12 May.'),
      userMessage('And in June?', later(1000)),
      reply('TAP at 95 euros on 3 June.', { createdAt: later(2000) }),
    ]);
    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });

    const updated = await db.getProjectThread(userId, thread._id!.toString());
    expect(updated?.status).toBe('done');
    expect(updated?.run).toBe('idle');
    expect(updated?.summary).toBe('Summary: TAP at 95 euros on 3 June.');
    expect(harness.requests[1]).toMatchObject({
      followUp: 'And in June?',
      previous: 'Summary: KLM at 89 euros on 12 May.',
    });
    expect(harness.enqueued).toHaveLength(1);

    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });
    expect(harness.requests).toHaveLength(2);
  });

  it('leaves the hand-back alone when the option is off', async () => {
    const harness = createHarness({
      getConfig: async () => ({ enabled: true, concurrency: 1, summaryMaxTokens: 20 }),
    });
    const thread = await start(harness);
    await harness.service.pump();
    harness.messages.set(thread.conversationId, [reply('KLM at 89 euros on 12 May.')]);
    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });
    harness.messages.set(thread.conversationId, [
      userMessage('And in June?', later(1000)),
      reply('TAP at 95 euros on 3 June.', { createdAt: later(2000) }),
    ]);
    await harness.service.handleSettled({
      userId,
      conversationId: thread.conversationId,
      status: 'complete',
    });
    const unchanged = await db.getProjectThread(userId, thread._id!.toString());
    expect(unchanged?.summary).toBe('Summary: KLM at 89 euros on 12 May.');
  });

  it('records a chat the user started in the project as a thread, but not the coordinator', async () => {
    const harness = createUserTurnHarness({
      getProjectChat: async (_user, conversationId) => ({
        projectId: 'p1',
        coordinatorConversationId: 'coord',
        agentId: conversationId === 'own' ? 'ephemeral' : null,
        title: 'New Chat',
      }),
    });
    await mongoose.models.Conversation.create({
      user: userId,
      conversationId: 'own',
      endpoint: 'agents',
      title: 'Packing',
    });
    harness.messages.set('own', [
      userMessage('Make a packing list for Lisbon', new Date()),
      reply('Light jacket, sandals, adapter.'),
    ]);
    harness.messages.set('coord', [
      userMessage('Plan the trip', new Date()),
      reply('Starting threads.'),
    ]);

    await harness.service.handleSettled({ userId, conversationId: 'own', status: 'complete' });
    await harness.service.handleSettled({ userId, conversationId: 'coord', status: 'complete' });

    const adopted = await db.getProjectThreadByConversation(userId, 'own');
    expect(adopted).toMatchObject({
      projectId: 'p1',
      agentId: 'agent_benny',
      title: 'Make a packing list for Lisbon',
      brief: 'Make a packing list for Lisbon',
      status: 'done',
      run: 'idle',
      summary: 'Summary: Light jacket, sandals, adapter.',
    });
    const convo = await mongoose.models.Conversation.findOne({ conversationId: 'own' }).lean<{
      threadStatus?: string;
      title?: string;
    }>();
    expect(convo).toMatchObject({ threadStatus: 'done', title: 'Packing' });
    expect(await db.getProjectThreadByConversation(userId, 'coord')).toBeNull();
    expect(harness.enqueued).toHaveLength(0);
  });
});
