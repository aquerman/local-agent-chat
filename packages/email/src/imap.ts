import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { FetchMessageObject, MessageAddressObject, SearchObject } from 'imapflow';
import type { AddressObject, ParsedMail } from 'mailparser';
import type {
  MessageSummary,
  MessageDetail,
  SearchCriteria,
  SearchResult,
  MailStore,
} from '~/store';
import type { ImapSettings, Limits } from '~/limits';
import { MailError } from '~/store';

function formatAddresses(list: MessageAddressObject[] | undefined): string {
  if (!list || list.length === 0) {
    return '';
  }
  return list
    .map(({ name, address }) => (name && address ? `${name} <${address}>` : name || address || ''))
    .filter(Boolean)
    .join(', ');
}

function parsedAddresses(value: AddressObject | AddressObject[] | undefined): string {
  if (!value) {
    return '';
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => entry.text).join(', ');
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toSummary(message: FetchMessageObject): MessageSummary {
  const envelope = message.envelope;
  return {
    id: message.uid,
    date: toDate(envelope?.date) ?? toDate(message.internalDate),
    from: formatAddresses(envelope?.from),
    subject: envelope?.subject ?? '',
    unread: !(message.flags?.has('\\Seen') ?? false),
  };
}

function toDetail(id: number, parsed: ParsedMail): MessageDetail {
  return {
    id,
    date: parsed.date,
    from: parsedAddresses(parsed.from),
    to: parsedAddresses(parsed.to),
    cc: parsedAddresses(parsed.cc),
    subject: parsed.subject ?? '',
    text: (parsed.text ?? '').trim(),
    attachments: parsed.attachments.map((attachment) => attachment.filename ?? '(unnamed)'),
  };
}

function toSearchObject(criteria: SearchCriteria): SearchObject {
  const query: SearchObject = {};
  if (criteria.text) {
    query.text = criteria.text;
  }
  if (criteria.from) {
    query.from = criteria.from;
  }
  if (criteria.subject) {
    query.subject = criteria.subject;
  }
  if (criteria.since) {
    query.since = criteria.since;
  }
  if (criteria.before) {
    query.before = criteria.before;
  }
  if (criteria.unreadOnly) {
    query.seen = false;
  }
  return Object.keys(query).length === 0 ? { all: true } : query;
}

/** Hides credentials and server chatter behind one readable message. */
function describeFailure(err: unknown, host: string): MailError {
  if (err instanceof MailError) {
    return err;
  }
  const failure = err as { authenticationFailed?: boolean; code?: string; message?: string };
  if (failure.authenticationFailed) {
    return new MailError(
      `The mail server ${host} rejected the login. Check the user name and app password in the email connector settings.`,
    );
  }
  if (
    failure.code === 'NoConnection' ||
    failure.code === 'ETIMEDOUT' ||
    failure.code === 'ENOTFOUND'
  ) {
    return new MailError(`Could not reach the mail server ${host}.`);
  }
  const reason = failure.message ?? String(err);
  return new MailError(`Mail server error: ${reason}`);
}

/**
 * A {@link MailStore} over IMAP. Every call opens its own connection and the folder
 * with EXAMINE (`readOnly: true`), so reading a message never marks it as seen.
 */
export function createImapStore(settings: ImapSettings, limits: Limits): MailStore {
  async function withClient<T>(work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: limits.timeoutMs,
      greetingTimeout: limits.timeoutMs,
      socketTimeout: limits.timeoutMs,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      return await work(client);
    } catch (err) {
      throw describeFailure(err, settings.host);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  async function inFolder<T>(client: ImapFlow, folder: string, work: () => Promise<T>): Promise<T> {
    let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>>;
    try {
      lock = await client.getMailboxLock(folder, { readOnly: true });
    } catch {
      throw new MailError(`No folder named "${folder}". Use list_folders to see the folder names.`);
    }
    try {
      return await work();
    } finally {
      lock.release();
    }
  }

  return {
    listFolders: () =>
      withClient(async (client) => {
        const folders = await client.list();
        return folders.map((folder) => folder.path);
      }),

    search: (folder, criteria, limit) =>
      withClient((client) =>
        inFolder(client, folder, async () => {
          const uids = (await client.search(toSearchObject(criteria), { uid: true })) || [];
          const newest = [...uids].sort((a, b) => b - a).slice(0, limit);
          if (newest.length === 0) {
            return { total: uids.length, messages: [] } satisfies SearchResult;
          }
          const messages: MessageSummary[] = [];
          for await (const message of client.fetch(
            newest,
            { uid: true, envelope: true, flags: true, internalDate: true },
            { uid: true },
          )) {
            messages.push(toSummary(message));
          }
          messages.sort((a, b) => b.id - a.id);
          return { total: uids.length, messages };
        }),
      ),

    read: (folder, id) =>
      withClient((client) =>
        inFolder(client, folder, async () => {
          const message = await client.fetchOne(
            String(id),
            { uid: true, source: { start: 0, maxLength: limits.maxSourceBytes } },
            { uid: true },
          );
          if (!message || !message.source) {
            return null;
          }
          return toDetail(id, await simpleParser(message.source));
        }),
      ),
  };
}
