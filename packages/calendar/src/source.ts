import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ParsedCalendar } from '~/events';
import type { Limits } from '~/limits';
import { parseCalendar } from '~/events';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type ReadFileFn = (path: string) => Promise<string>;

export class CalendarSourceError extends Error {}

export interface SourceDeps {
  fetch: FetchFn;
  readFile: ReadFileFn;
  limits: Limits;
  now: () => number;
}

/** Hides the secret part of a feed URL (path and query) in messages and logs. */
export function describeSource(source: string): string {
  if (!/^(https?|webcal):\/\//i.test(source)) {
    return 'calendar file';
  }
  try {
    return `calendar feed at ${new URL(source.replace(/^webcal:/i, 'https:')).host}`;
  } catch {
    return 'calendar feed';
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new CalendarSourceError(`Calendar is larger than the ${maxBytes}-byte limit`);
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new CalendarSourceError(`Calendar is larger than the ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function download(source: string, deps: SourceDeps): Promise<string> {
  const url = source.replace(/^webcal:/i, 'https:');
  const signal = AbortSignal.timeout(deps.limits.timeoutMs);
  let response: Response;
  try {
    response = await deps.fetch(url, {
      signal,
      headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'failed';
    throw new CalendarSourceError(`Download of the ${describeSource(source)} ${reason}`);
  }
  if (!response.ok) {
    throw new CalendarSourceError(`The ${describeSource(source)} answered HTTP ${response.status}`);
  }
  return readCapped(response, deps.limits.maxBytes);
}

async function readLocal(source: string, deps: SourceDeps): Promise<string> {
  const path = source.startsWith('file:') ? fileURLToPath(source) : source;
  try {
    return await deps.readFile(path);
  } catch {
    throw new CalendarSourceError(`Could not read the ${describeSource(source)}`);
  }
}

/** Loads ICS text from an http(s)/webcal URL or a local path, parsed and cached for `cacheMs`. */
export function createCalendarLoader(sources: readonly string[], deps: SourceDeps) {
  const cache = new Map<string, { at: number; calendar: ParsedCalendar }>();

  async function loadOne(source: string): Promise<ParsedCalendar> {
    const hit = cache.get(source);
    if (hit && deps.now() - hit.at < deps.limits.cacheMs) {
      return hit.calendar;
    }
    const remote = /^(https?|webcal):\/\//i.test(source);
    const text = remote ? await download(source, deps) : await readLocal(source, deps);
    const calendar = parseCalendar(text);
    cache.set(source, { at: deps.now(), calendar });
    return calendar;
  }

  return async function loadAll(): Promise<ParsedCalendar[]> {
    if (sources.length === 0) {
      throw new CalendarSourceError(
        'No calendar is connected. Set the ICS address in the calendar connector settings.',
      );
    }
    return Promise.all(sources.map(loadOne));
  };
}

export type CalendarLoader = ReturnType<typeof createCalendarLoader>;

export const nodeReadFile: ReadFileFn = (path) => readFile(path, 'utf8');
