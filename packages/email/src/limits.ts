export interface Limits {
  timeoutMs: number;
  maxChars: number;
  maxCharsCap: number;
  maxResults: number;
  maxResultsCap: number;
  maxSourceBytes: number;
}

export const DEFAULT_LIMITS: Limits = {
  timeoutMs: 20_000,
  maxChars: 4000,
  maxCharsCap: 20_000,
  maxResults: 10,
  maxResultsCap: 50,
  maxSourceBytes: 2_000_000,
};

export interface ImapSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface EmailConfig {
  /** Undefined until the user has filled in host, user and password. */
  imap?: ImapSettings;
  limits: Limits;
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * LibreChat passes an unfilled per-user setting through verbatim (`{{EMAIL_USER}}`),
 * so a placeholder counts as missing.
 */
function setting(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /^\{\{.*\}\}$/.test(trimmed) || /^\$\{.*\}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function readConfig(env: NodeJS.ProcessEnv): EmailConfig {
  const maxChars = positiveInt(env.EMAIL_MAX_CHARS);
  const limits: Limits = {
    ...DEFAULT_LIMITS,
    timeoutMs: positiveInt(env.EMAIL_TIMEOUT_MS) ?? DEFAULT_LIMITS.timeoutMs,
    maxChars: Math.min(maxChars ?? DEFAULT_LIMITS.maxChars, DEFAULT_LIMITS.maxCharsCap),
  };
  const host = setting(env.EMAIL_IMAP_HOST);
  const user = setting(env.EMAIL_USER);
  const password = setting(env.EMAIL_PASSWORD);
  if (!host || !user || !password) {
    return { limits };
  }
  const secure = setting(env.EMAIL_IMAP_SECURE)?.toLowerCase() !== 'false';
  const port = positiveInt(setting(env.EMAIL_IMAP_PORT)) ?? (secure ? 993 : 143);
  return { imap: { host, port, secure, user, password }, limits };
}
