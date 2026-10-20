import http from 'http';
import type { TNotificationsConfig } from 'librechat-data-provider';
import type { AddressInfo } from 'net';
import type { ReplyMessage, RoutineNotificationDeps } from './routines';
import type { ScheduleRunOutcome } from '../schedules/listener';
import { createRoutineNotifications, firstLine } from './routines';
import { withRunOutcomeListener } from '../schedules/listener';

interface Received {
  path?: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/** A fake ntfy server: records every publish and answers with `status`. */
async function startFakeNtfy(status = 200): Promise<{
  url: string;
  received: Received[];
  close: () => Promise<void>;
}> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const SCHEDULE = { name: 'Morning brief', user: { toString: () => 'user-1' } };

function makeDeps(
  config: TNotificationsConfig | undefined,
  messages: ReplyMessage[] = [],
): RoutineNotificationDeps & { getMessages: jest.Mock } {
  return {
    getConfig: async () => config,
    getSchedule: async () => SCHEDULE,
    getMessages: jest.fn(async () => messages),
  };
}

function configFor(
  server: string,
  overrides: Partial<TNotificationsConfig> = {},
): TNotificationsConfig {
  return {
    enabled: true,
    includeReply: true,
    timeoutMs: 2000,
    publicBaseUrl: 'http://chat.example.test/',
    ntfy: { server, topic: 'routines-test' },
    events: { routineSucceeded: true, routineFailed: true, routineNeedsApproval: true },
    ...overrides,
  };
}

const success: ScheduleRunOutcome = {
  scheduleId: 'sched-1',
  scheduledFor: new Date('2026-10-20T07:00:00Z'),
  status: 'success',
  conversationId: 'conv-1',
  autoDisableAfterFailures: 5,
};

describe('createRoutineNotifications', () => {
  let ntfy: Awaited<ReturnType<typeof startFakeNtfy>>;

  beforeEach(async () => {
    ntfy = await startFakeNtfy();
  });

  afterEach(async () => {
    await ntfy.close();
    delete process.env.TEST_NTFY_TOPIC;
  });

  it('posts the routine name, the first line of the reply, and the chat link', async () => {
    const deps = makeDeps(configFor(ntfy.url), [
      {
        text: '',
        content: [
          { type: 'think', text: 'ignored' },
          { type: 'text', text: '\n## Your day\n- Three meetings, first at 9:00' },
        ],
      },
    ]);
    await createRoutineNotifications(deps)(success);

    expect(ntfy.received).toHaveLength(1);
    expect(ntfy.received[0].path).toBe('/');
    expect(ntfy.received[0].body).toEqual({
      topic: 'routines-test',
      title: 'Morning brief',
      message: 'Your day',
      click: 'http://chat.example.test/c/conv-1',
    });
    expect(deps.getMessages).toHaveBeenCalledWith(
      { conversationId: 'conv-1', user: 'user-1', isCreatedByUser: false },
      'text content',
      { sort: { createdAt: -1 }, limit: 1 },
    );
  });

  it('resolves ${ENV} values and sends the token as a bearer header', async () => {
    process.env.TEST_NTFY_TOPIC = 'from-env';
    const config = configFor(ntfy.url);
    config.ntfy = { server: ntfy.url, topic: '${TEST_NTFY_TOPIC}', token: 'tk_secret' };
    await createRoutineNotifications(makeDeps(config, [{ text: 'Done' }]))(success);

    expect(ntfy.received[0].body.topic).toBe('from-env');
    expect(ntfy.received[0].headers.authorization).toBe('Bearer tk_secret');
  });

  it('sends nothing when disabled, unconfigured, or the topic env var is unset', async () => {
    const off = configFor(ntfy.url, { enabled: false });
    const unset = configFor(ntfy.url);
    unset.ntfy = { server: ntfy.url, topic: '${TEST_NTFY_TOPIC}' };
    for (const config of [undefined, off, unset]) {
      await createRoutineNotifications(makeDeps(config, [{ text: 'Done' }]))(success);
    }
    expect(ntfy.received).toHaveLength(0);
  });

  it('marks failures and approval pauses as high priority', async () => {
    const notify = createRoutineNotifications(makeDeps(configFor(ntfy.url)));
    await notify({ ...success, status: 'error', error: 'Run ended in error' });
    await notify({ ...success, status: 'requires_action' });
    await notify({ ...success, status: 'interrupted' });

    expect(ntfy.received.map((r) => [r.body.title, r.body.priority])).toEqual([
      ['Morning brief failed', 4],
      ['Morning brief needs your approval', 4],
    ]);
  });

  it('keeps chat content off the wire when includeReply is false', async () => {
    const deps = makeDeps(configFor(ntfy.url, { includeReply: false }), [{ text: 'Secret' }]);
    await createRoutineNotifications(deps)(success);
    expect(ntfy.received[0].body.message).toBe('Routine finished.');
    expect(deps.getMessages).not.toHaveBeenCalled();
  });

  it('applies schema defaults to a raw YAML block', async () => {
    const raw = { enabled: true, ntfy: { server: ntfy.url, topic: 'raw-topic' } };
    await createRoutineNotifications({
      getConfig: async () => raw,
      getSchedule: async () => SCHEDULE,
      getMessages: async () => [{ text: 'Done' }],
    })(success);
    expect(ntfy.received[0].body).toEqual({
      topic: 'raw-topic',
      title: 'Morning brief',
      message: 'Done',
    });
  });

  it('respects per-event switches', async () => {
    const config = configFor(ntfy.url, {
      events: { routineSucceeded: false, routineFailed: true, routineNeedsApproval: true },
    });
    await createRoutineNotifications(makeDeps(config, [{ text: 'Done' }]))(success);
    expect(ntfy.received).toHaveLength(0);
  });

  it('rejects on a non-2xx answer so the caller can log it', async () => {
    const failing = await startFakeNtfy(500);
    try {
      const notify = createRoutineNotifications(makeDeps(configFor(failing.url), [{ text: 'x' }]));
      await expect(notify(success)).rejects.toThrow('HTTP 500');
    } finally {
      await failing.close();
    }
  });
});

describe('withRunOutcomeListener', () => {
  it('notifies only applied transitions and never fails the run', async () => {
    const results = [true, false];
    const recordRunOutcome = jest.fn(
      async (_outcome: ScheduleRunOutcome) => results.shift() ?? false,
    );
    const listener = jest.fn(async (_outcome: ScheduleRunOutcome) => {
      throw new Error('ntfy unreachable');
    });
    const methods = withRunOutcomeListener({ recordRunOutcome }, listener);

    await expect(methods.recordRunOutcome(success)).resolves.toBe(true);
    await expect(methods.recordRunOutcome(success)).resolves.toBe(false);
    await new Promise((resolve) => setImmediate(resolve));

    expect(recordRunOutcome).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(success);
  });

  it('returns the methods untouched without a listener', () => {
    const methods = { recordRunOutcome: jest.fn(async () => true) };
    expect(withRunOutcomeListener(methods)).toBe(methods);
  });
});

describe('firstLine', () => {
  it('drops thinking blocks and truncates long lines', () => {
    expect(firstLine('<think>plan</think>\n\n> Quote line')).toBe('Quote line');
    expect(firstLine('a'.repeat(300))).toHaveLength(200);
  });
});
