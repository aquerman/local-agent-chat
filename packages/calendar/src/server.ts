import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { CalendarEvent, Range } from '~/events';
import type { CalendarLoader } from '~/source';
import type { Limits } from '~/limits';
import { buildRange, describeRange, formatEvents, parseStart, DateInputError } from '~/format';
import { CalendarParseError, eventsInRange } from '~/events';
import { CalendarSourceError } from '~/source';
import { addDays } from '~/zone';

export interface ServerOptions {
  load: CalendarLoader;
  timeZone: string;
  limits: Limits;
  now?: () => Date;
}

const LIST_DESCRIPTION =
  "List the user's calendar events (read-only). Call it with no arguments for today and the " +
  'next 6 days ("this week", "what is next"); it knows today\'s date. Recurring events are expanded.';

const SEARCH_DESCRIPTION =
  "Find the user's calendar events whose title, location or notes contain the given words " +
  '(read-only). Defaults to 30 days back through one year ahead.';

const START_HINT =
  'Leave out unless the user names a day. Then: YYYY-MM-DD, or tomorrow / yesterday. Default: today';

/** Search looks back this far by default, so "when was my last dentist visit" works. */
const SEARCH_LOOKBACK_DAYS = 30;
const SEARCH_DEFAULT_DAYS = 395;

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function error(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

function toMessage(err: unknown): string {
  if (
    err instanceof CalendarSourceError ||
    err instanceof CalendarParseError ||
    err instanceof DateInputError
  ) {
    return err.message;
  }
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`calendar: unexpected error: ${reason}\n`);
  return `Calendar lookup failed: ${reason}`;
}

function matchesAll(event: CalendarEvent, words: string[]): boolean {
  const haystack = [event.title, event.location, event.description]
    .filter((part): part is string => part !== undefined)
    .join('\n')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function createServer(options: ServerOptions): McpServer {
  const { load, timeZone, limits } = options;
  const now = options.now ?? (() => new Date());
  const server = new McpServer({ name: 'librechat-calendar', version: '0.1.0' });

  const days = (fallback: number) =>
    z
      .number()
      .int()
      .min(1)
      .max(limits.maxRangeDays)
      .optional()
      .describe(`Number of days to cover (default ${fallback})`);

  const maxResults = z
    .number()
    .int()
    .min(1)
    .max(limits.maxResultsCap)
    .optional()
    .describe(`Maximum events to return (default ${limits.maxResults})`);

  async function collect(range: Range): Promise<{ events: CalendarEvent[]; many: boolean }> {
    const calendars = await load();
    const events = calendars
      .flatMap((calendar) => eventsInRange(calendar, range, timeZone))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return { events, many: calendars.length > 1 };
  }

  function render(
    heading: string,
    events: CalendarEvent[],
    many: boolean,
    limit: number | undefined,
  ): string {
    return formatEvents(heading, events, {
      timeZone,
      maxResults: limit ?? limits.maxResults,
      maxDescriptionChars: limits.maxDescriptionChars,
      showCalendar: many,
    });
  }

  server.registerTool(
    'list_events',
    {
      title: 'List calendar events',
      description: LIST_DESCRIPTION,
      inputSchema: {
        start: z.string().optional().describe(START_HINT),
        days: days(7),
        maxResults,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ start, days: span, maxResults: limit }) => {
      try {
        const current = now();
        const range = buildRange(parseStart(start, current, timeZone), span ?? 7, timeZone);
        const { events, many } = await collect(range);
        return text(render(describeRange(range, current, timeZone), events, many, limit));
      } catch (err) {
        return error(toMessage(err));
      }
    },
  );

  server.registerTool(
    'search_events',
    {
      title: 'Search calendar events',
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).describe('Words to look for, e.g. "dentist" or "Anna birthday"'),
        start: z
          .string()
          .optional()
          .describe(
            `Leave out unless the user names a day (YYYY-MM-DD). Default: ${SEARCH_LOOKBACK_DAYS} days ago`,
          ),
        days: days(SEARCH_DEFAULT_DAYS),
        maxResults,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, start, days: span, maxResults: limit }) => {
      try {
        const current = now();
        const first =
          start === undefined
            ? addDays(parseStart('today', current, timeZone), -SEARCH_LOOKBACK_DAYS, timeZone)
            : parseStart(start, current, timeZone);
        const range = buildRange(first, span ?? SEARCH_DEFAULT_DAYS, timeZone);
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const { events, many } = await collect(range);
        const matches = events.filter((event) => matchesAll(event, words));
        const heading = `${describeRange(range, current, timeZone)} matching "${query}"`;
        return text(render(heading, matches, many, limit));
      } catch (err) {
        return error(toMessage(err));
      }
    },
  );

  return server;
}
