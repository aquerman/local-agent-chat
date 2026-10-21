import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FetchFn, ReadFileFn } from '~/source';
import { createCalendarLoader } from '~/source';
import { DEFAULT_LIMITS } from '~/limits';
import { createServer } from '~/server';

const FIXTURE = path.join(__dirname, 'fixtures', 'personal.ics');
const ics = fs.readFileSync(FIXTURE, 'utf8');
const timeZone = 'Europe/Amsterdam';
/** Tuesday 20 Oct 2026, 10:00 in Amsterdam (CEST); DST ends on Sunday 25 Oct. */
const now = new Date('2026-10-20T08:00:00Z');
const limits = { ...DEFAULT_LIMITS, timeoutMs: 500 };

interface TextResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const noFetch: FetchFn = () => Promise.reject(new Error('no network in tests'));
const diskRead: ReadFileFn = (file) => fs.promises.readFile(file, 'utf8');

async function connect(sources: string[], fetchFn: FetchFn = noFetch): Promise<Client> {
  const load = createCalendarLoader(sources, {
    fetch: fetchFn,
    readFile: diskRead,
    limits,
    now: () => now.getTime(),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ load, timeZone, limits, now: () => now }).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as TextResult;
  return { text: result.content.map((part) => part.text ?? '').join('\n'), error: result.isError };
}

describe('calendar MCP server', () => {
  it('exposes only read-only tools', async () => {
    const client = await connect([FIXTURE]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['list_events', 'search_events']);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('lists the next 7 days with recurrences, exceptions and time zones resolved', async () => {
    const client = await connect([FIXTURE]);
    const { text, error } = await call(client, 'list_events', {});
    expect(error).toBeFalsy();
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      'Now: Tue 20 Oct 2026 10:00 (Europe/Amsterdam). Events Tue 20 Oct 2026 to Mon 26 Oct 2026 (6 found):',
    );
    expect(lines.slice(1)).toEqual([
      '- Wed 21 Oct 2026 14:00-14:15: Team standup (moved) @ Video call',
      '- Thu 22 Oct 2026 15:00-15:45: Dentist @ Main Street 1',
      '  Yearly check-up. Bring the insurance card.',
      '- Fri 23 Oct 2026 15:00-16:00: Call with the New York office',
      '- Sat 24 Oct 2026 - Mon 26 Oct 2026, all day: Weekend away',
      '- Mon 26 Oct 2026 09:15-09:30: Team standup @ Video call',
      '- Mon 26 Oct 2026 19:00-20:00: Gym',
    ]);
    expect(text).not.toContain('Cancelled');
  });

  it('honours EXDATE and keeps local wall time across the DST change', async () => {
    const client = await connect([FIXTURE]);
    const { text } = await call(client, 'list_events', { start: '2026-10-26', days: 10 });
    const standups = text.split('\n').filter((line) => line.includes('Team standup'));
    expect(standups).toEqual([
      '- Mon 26 Oct 2026 09:15-09:30: Team standup @ Video call',
      '- Mon 2 Nov 2026 09:15-09:30: Team standup @ Video call',
      '- Wed 4 Nov 2026 09:15-09:30: Team standup @ Video call',
    ]);
  });

  it('searches title, location and notes, looking back 30 days by default', async () => {
    const client = await connect([FIXTURE]);
    const dentist = await call(client, 'search_events', { query: 'dentist' });
    expect(dentist.text).toContain('(1 found)');
    expect(dentist.text).toContain('Thu 22 Oct 2026 15:00-15:45: Dentist');
    const past = await call(client, 'search_events', { query: 'Dentist', start: '2026-01-01' });
    expect(past.text).toContain('(2 found)');
    expect(past.text).toContain('Wed 15 Apr 2026 10:00-10:30: Dentist');
    const notes = await call(client, 'search_events', { query: 'insurance card' });
    expect(notes.text).toContain('Dentist');
    const none = await call(client, 'search_events', { query: 'opera' });
    expect(none.text).toMatch(/: no events\.$/);
  });

  it('caps the number of events returned', async () => {
    const client = await connect([FIXTURE]);
    const { text } = await call(client, 'list_events', { maxResults: 2 });
    expect(text).toContain('(6 found)');
    expect(text).toContain('(4 more not shown; narrow the range to see them)');
  });

  it('accepts relative day words', async () => {
    const client = await connect([FIXTURE]);
    const { text } = await call(client, 'list_events', { start: 'tomorrow', days: 1 });
    expect(text).toContain('Events Wed 21 Oct 2026 (1 found):');
    expect(text).toContain('(1 found)');
  });

  it('downloads webcal feeds over https and labels several calendars', async () => {
    const seen: string[] = [];
    const fetchFn: FetchFn = (url) => {
      seen.push(url);
      return Promise.resolve(new Response(ics, { headers: { 'content-type': 'text/calendar' } }));
    };
    const client = await connect(
      [FIXTURE, 'webcal://calendar.example.com/secret/basic.ics'],
      fetchFn,
    );
    const { text } = await call(client, 'list_events', { start: '2026-10-22', days: 1 });
    expect(seen).toEqual(['https://calendar.example.com/secret/basic.ics']);
    expect(text).toContain('(2 found)');
    expect(text).toContain('[Personal]');
  });

  it('caches a feed between calls', async () => {
    let downloads = 0;
    const fetchFn: FetchFn = () => {
      downloads++;
      return Promise.resolve(new Response(ics));
    };
    const client = await connect(['https://calendar.example.com/a.ics'], fetchFn);
    await call(client, 'list_events', {});
    await call(client, 'search_events', { query: 'gym' });
    expect(downloads).toBe(1);
  });

  it('reports failures as tool errors without leaking the secret URL', async () => {
    const failing: FetchFn = () => Promise.resolve(new Response('nope', { status: 404 }));
    const client = await connect(['https://calendar.example.com/private-token/basic.ics'], failing);
    const { text, error } = await call(client, 'list_events', {});
    expect(error).toBe(true);
    expect(text).toBe('The calendar feed at calendar.example.com answered HTTP 404');
    expect(text).not.toContain('private-token');
  });

  it('rejects oversized feeds and invalid ICS', async () => {
    const huge: FetchFn = () => Promise.resolve(new Response('x'.repeat(limits.maxBytes + 1)));
    const big = await call(await connect(['https://example.com/big.ics'], huge), 'list_events', {});
    expect(big.error).toBe(true);
    expect(big.text).toContain('larger than');
    const junk: FetchFn = () => Promise.resolve(new Response('<html>login</html>'));
    const bad = await call(await connect(['https://example.com/x.ics'], junk), 'list_events', {});
    expect(bad.error).toBe(true);
    expect(bad.text).toContain('Not a valid iCalendar file');
  });

  it('explains how to connect when no calendar is set', async () => {
    const { text, error } = await call(await connect([]), 'list_events', {});
    expect(error).toBe(true);
    expect(text).toContain('No calendar is connected');
  });

  it('rejects an unreadable start date', async () => {
    const { text, error } = await call(await connect([FIXTURE]), 'list_events', {
      start: 'next fortnight',
    });
    expect(error).toBe(true);
    expect(text).toContain('Use YYYY-MM-DD');
  });
});
