import { isTimeZone } from '~/zone';

export interface Limits {
  timeoutMs: number;
  maxBytes: number;
  cacheMs: number;
  maxResults: number;
  maxResultsCap: number;
  maxRangeDays: number;
  maxDescriptionChars: number;
}

export const DEFAULT_LIMITS: Limits = {
  timeoutMs: 15_000,
  maxBytes: 10_000_000,
  cacheMs: 5 * 60_000,
  maxResults: 30,
  maxResultsCap: 100,
  maxRangeDays: 366,
  maxDescriptionChars: 200,
};

export interface CalendarConfig {
  sources: string[];
  timeZone: string;
  limits: Limits;
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * An unfilled LibreChat placeholder (`{{CALENDAR_ICS_URL}}`) reaches the process
 * verbatim when the user has not saved the setting yet; treat it as "not set".
 */
function isPlaceholder(value: string): boolean {
  return /^\{\{.*\}\}$/.test(value) || /^\$\{.*\}$/.test(value);
}

/** Several feeds are separated by `|` (a character Windows paths and ICS URLs never contain). */
export function parseSources(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[|\r\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !isPlaceholder(entry));
}

export function readConfig(env: NodeJS.ProcessEnv): CalendarConfig {
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = isTimeZone(env.CALENDAR_TIMEZONE) ? env.CALENDAR_TIMEZONE : systemZone;
  const cacheSeconds = nonNegativeInt(env.CALENDAR_CACHE_SECONDS);
  return {
    sources: parseSources(env.CALENDAR_ICS_URL),
    timeZone,
    limits: {
      ...DEFAULT_LIMITS,
      timeoutMs: positiveInt(env.CALENDAR_TIMEOUT_MS) ?? DEFAULT_LIMITS.timeoutMs,
      maxBytes: positiveInt(env.CALENDAR_MAX_BYTES) ?? DEFAULT_LIMITS.maxBytes,
      cacheMs: cacheSeconds !== undefined ? cacheSeconds * 1000 : DEFAULT_LIMITS.cacheMs,
    },
  };
}
