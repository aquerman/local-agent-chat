import { logger } from '@librechat/data-schemas';
import { extractEnvVariable, notificationsSchema } from 'librechat-data-provider';
import type { TNotificationsConfig, TNotificationsConfigInput } from 'librechat-data-provider';
import type { FetchLike, Notifier } from './types';
import { createNtfyNotifier } from './ntfy';

export interface ResolvedNotifications {
  notifier: Notifier;
  publicBaseUrl?: string;
  includeReply: boolean;
  events: TNotificationsConfig['events'];
}

/** Resolves a `${ENV}` reference; an unset variable reads as absent rather than as its literal name. */
function resolveValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const resolved = extractEnvVariable(value).trim();
  if (resolved === '' || /\$\{[^}]+\}/.test(resolved)) {
    return undefined;
  }
  return resolved;
}

function resolveBaseUrl(value: string | undefined): string | undefined {
  const resolved = resolveValue(value);
  if (!resolved) {
    return undefined;
  }
  try {
    const url = new URL(resolved);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    return resolved.replace(/\/+$/, '');
  } catch {
    logger.warn('[notifications] publicBaseUrl is not a valid URL; notifications will not link');
    return undefined;
  }
}

/**
 * Turns the `notifications` config block into a ready channel, or `null` when notifications
 * are off or incompletely configured (logged, never thrown: a missing topic must not break runs).
 */
export function resolveNotifications(
  raw: TNotificationsConfigInput | undefined,
  fetchImpl?: FetchLike,
): ResolvedNotifications | null {
  if (!raw?.enabled) {
    return null;
  }
  const parsed = notificationsSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn('[notifications] invalid `notifications` config; skipping', parsed.error.issues);
    return null;
  }
  const config = parsed.data;
  const topic = resolveValue(config.ntfy?.topic);
  const server = resolveValue(config.ntfy?.server) ?? 'https://ntfy.sh';
  if (!topic) {
    logger.warn('[notifications] enabled, but no ntfy topic is configured; skipping');
    return null;
  }
  return {
    notifier: createNtfyNotifier({
      server,
      topic,
      token: resolveValue(config.ntfy?.token),
      timeoutMs: config.timeoutMs,
      fetch: fetchImpl,
    }),
    publicBaseUrl: resolveBaseUrl(config.publicBaseUrl),
    includeReply: config.includeReply,
    events: config.events,
  };
}
