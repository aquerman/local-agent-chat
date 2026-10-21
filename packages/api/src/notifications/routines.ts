import { logger } from '@librechat/data-schemas';
import type { TNotificationsConfigInput } from 'librechat-data-provider';
import type { ScheduleMethods } from '@librechat/data-schemas';
import type { FetchLike, Notification } from './types';
import { resolveNotifications } from './config';

type RunOutcome = Parameters<ScheduleMethods['recordRunOutcome']>[0];

/** The subset of a stored message a notification body is read from. */
export interface ReplyMessage {
  text?: string | null;
  content?: Array<{ type?: string; text?: string | { value?: string } }> | null;
}

export interface RoutineNotificationDeps {
  /** The raw `notifications` block (defaults are applied here, not by the caller). */
  getConfig: () => Promise<TNotificationsConfigInput | undefined>;
  getSchedule: (
    scheduleId: string,
  ) => Promise<{ name: string; user: { toString(): string } } | null>;
  getMessages: (
    filter: { conversationId: string; user: string; isCreatedByUser: boolean },
    select: string,
    options: { sort: { createdAt: -1 }; limit: number },
  ) => Promise<ReplyMessage[]>;
  fetch?: FetchLike;
}

const MAX_BODY_CHARS = 200;

function replyText(message: ReplyMessage): string {
  const parts = (message.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => (typeof part.text === 'string' ? part.text : (part.text?.value ?? '')));
  const joined = parts.join('\n').trim();
  return joined !== '' ? joined : (message.text ?? '');
}

/** First meaningful line of a reply, without thinking blocks or leading Markdown markers. */
export function firstLine(text: string): string {
  const line = text
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .split('\n')
    .map((candidate) => candidate.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+)/, '').trim())
    .find((candidate) => candidate !== '');
  if (!line) {
    return '';
  }
  return line.length > MAX_BODY_CHARS ? `${line.slice(0, MAX_BODY_CHARS - 1)}…` : line;
}

/**
 * Builds the listener that tells the user's phone when a routine (scheduled chat) finishes,
 * fails, or pauses for approval. It reads config on every call, so a config reload applies
 * without a restart, and it throws only to its caller's catch, never into the run.
 */
export function createRoutineNotifications(
  deps: RoutineNotificationDeps,
): (outcome: RunOutcome) => Promise<void> {
  async function latestReply(conversationId: string, user: string): Promise<string> {
    const [message] = await deps.getMessages(
      { conversationId, user, isCreatedByUser: false },
      'text content',
      { sort: { createdAt: -1 }, limit: 1 },
    );
    return message ? firstLine(replyText(message)) : '';
  }

  async function compose(
    outcome: RunOutcome,
    name: string,
    reply: () => Promise<string>,
    url: string | undefined,
  ): Promise<Notification | null> {
    if (outcome.status === 'success') {
      const body = await reply();
      return { title: name, body: body || 'Routine finished.', url };
    }
    if (outcome.status === 'error') {
      return {
        title: `${name} failed`,
        body: outcome.error ? firstLine(outcome.error) : 'The routine ended with an error.',
        url,
        priority: 4,
      };
    }
    if (outcome.status === 'requires_action') {
      return {
        title: `${name} needs your approval`,
        body: 'Open the chat to approve or deny the tool call.',
        url,
        priority: 4,
      };
    }
    return null;
  }

  return async function notifyRoutineOutcome(outcome: RunOutcome): Promise<void> {
    const resolved = resolveNotifications(await deps.getConfig(), deps.fetch);
    if (resolved == null) {
      return;
    }
    const wanted =
      (outcome.status === 'success' && resolved.events.routineSucceeded) ||
      (outcome.status === 'error' && resolved.events.routineFailed) ||
      (outcome.status === 'requires_action' && resolved.events.routineNeedsApproval);
    if (!wanted) {
      return;
    }
    const schedule = await deps.getSchedule(outcome.scheduleId);
    if (schedule == null) {
      return;
    }
    const url =
      resolved.publicBaseUrl && outcome.conversationId
        ? `${resolved.publicBaseUrl}/c/${encodeURIComponent(outcome.conversationId)}`
        : resolved.publicBaseUrl;
    const conversationId = outcome.conversationId;
    const reply = async (): Promise<string> =>
      resolved.includeReply && conversationId
        ? latestReply(conversationId, schedule.user.toString())
        : '';
    const notification = await compose(outcome, schedule.name, reply, url);
    if (notification == null) {
      return;
    }
    await resolved.notifier.send(notification);
    logger.debug(`[notifications] sent routine ${outcome.status} for ${outcome.scheduleId}`);
  };
}
