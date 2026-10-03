export interface Limits {
  maxChars: number;
  maxCharsCap: number;
  timeoutMs: number;
  maxBytes: number;
  maxResults: number;
  maxResultsCap: number;
  minUsefulChars: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxChars: 8000,
  maxCharsCap: 20000,
  timeoutMs: 10000,
  maxBytes: 5_000_000,
  maxResults: 5,
  maxResultsCap: 10,
  minUsefulChars: 200,
};

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function readLimits(env: NodeJS.ProcessEnv): Limits {
  const maxChars = positiveInt(env.WEBSEARCH_MAX_CHARS);
  const timeoutMs = positiveInt(env.WEBSEARCH_TIMEOUT_MS);
  const maxBytes = positiveInt(env.WEBSEARCH_MAX_BYTES);
  return {
    ...DEFAULT_LIMITS,
    maxChars: Math.min(maxChars ?? DEFAULT_LIMITS.maxChars, DEFAULT_LIMITS.maxCharsCap),
    timeoutMs: timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    maxBytes: maxBytes ?? DEFAULT_LIMITS.maxBytes,
  };
}
