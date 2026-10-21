/** One message for the user's phone, shaped like a Claude Desktop task notification. */
export interface Notification {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url?: string;
  /** 1 (min) to 5 (max); 3 is the channel default. */
  priority?: 1 | 2 | 3 | 4 | 5;
}

/** A delivery channel (ntfy today; Web Push can implement the same contract later). */
export interface Notifier {
  send: (notification: Notification) => Promise<void>;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;
