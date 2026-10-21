import type { FetchLike, Notification, Notifier } from './types';

export interface NtfyOptions {
  server: string;
  topic: string;
  token?: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

/**
 * Publishes through ntfy's JSON API (`POST <server>/` with the topic in the body), which keeps
 * non-ASCII titles intact where the header-based API would need encoding.
 */
export function createNtfyNotifier(options: NtfyOptions): Notifier {
  const doFetch: FetchLike = options.fetch ?? fetch;
  const endpoint = options.server.replace(/\/+$/, '') + '/';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  return {
    async send(notification: Notification): Promise<void> {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          topic: options.topic,
          title: notification.title,
          message: notification.body,
          ...(notification.url ? { click: notification.url } : {}),
          ...(notification.priority ? { priority: notification.priority } : {}),
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`ntfy responded with HTTP ${response.status}`);
      }
    },
  };
}
