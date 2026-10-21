import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MessageDetail, MessageSummary, MailStore, SearchResult } from '~/store';
import type { Limits } from '~/limits';
import { MailError } from '~/store';

export interface ServerOptions {
  /** Undefined while the connector has no credentials yet. */
  store?: MailStore;
  limits: Limits;
}

const NOT_CONNECTED =
  'No mailbox is connected. Fill in the IMAP server, user name and app password in the email connector settings.';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function error(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

function toMessage(err: unknown): string {
  if (err instanceof MailError) {
    return err.message;
  }
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`email: unexpected error: ${reason}\n`);
  return `Mailbox lookup failed: ${reason}`;
}

function formatDate(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'no date';
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new MailError(`"${name}" must be a date like 2026-10-20.`);
  }
  return new Date(`${value}T00:00:00Z`);
}

function clip(value: string, maxChars: number): { text: string; truncated: boolean } {
  const compact = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (compact.length <= maxChars) {
    return { text: compact, truncated: false };
  }
  return { text: compact.slice(0, maxChars), truncated: true };
}

export function formatSummaries(folder: string, result: SearchResult): string {
  if (result.messages.length === 0) {
    return `No messages found in ${folder}.`;
  }
  const lines = result.messages.map((message: MessageSummary) => {
    const unread = message.unread ? ' [unread]' : '';
    const subject = message.subject === '' ? '(no subject)' : message.subject;
    return `- id ${message.id} | ${formatDate(message.date)} | ${message.from}${unread}\n  ${subject}`;
  });
  const heading =
    result.total > result.messages.length
      ? `${result.total} messages in ${folder} match; newest ${result.messages.length}:`
      : `${result.total} messages in ${folder} match:`;
  return [heading, ...lines, 'Use read_email with an id to open one.'].join('\n');
}

export function formatDetail(message: MessageDetail, maxChars: number): string {
  const body = clip(message.text, maxChars);
  const header = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    ...(message.cc ? [`Cc: ${message.cc}`] : []),
    `Date: ${formatDate(message.date)}`,
    `Subject: ${message.subject === '' ? '(no subject)' : message.subject}`,
    ...(message.attachments.length > 0 ? [`Attachments: ${message.attachments.join(', ')}`] : []),
  ];
  const tail = body.truncated ? [`[truncated at ${maxChars} chars]`] : [];
  return [...header, '', body.text === '' ? '(no text body)' : body.text, ...tail].join('\n');
}

export function createServer(options: ServerOptions): McpServer {
  const { store, limits } = options;
  const server = new McpServer({ name: 'librechat-email', version: '0.1.0' });
  const folder = z
    .string()
    .min(1)
    .optional()
    .describe('Mailbox folder (default INBOX); list_folders shows the names');

  async function run(work: (mail: MailStore) => Promise<string>): Promise<CallToolResult> {
    if (!store) {
      return error(NOT_CONNECTED);
    }
    try {
      return text(await work(store));
    } catch (err) {
      return error(toMessage(err));
    }
  }

  server.registerTool(
    'list_folders',
    {
      title: 'List mail folders',
      description: "List the folders of the user's mailbox (read-only).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(async (mail) => (await mail.listFolders()).join('\n')),
  );

  server.registerTool(
    'search_emails',
    {
      title: 'Search email',
      description:
        "Search the user's email (read-only). Returns newest matches first with id, date, " +
        'sender and subject; then call read_email with an id. All filters are optional.',
      inputSchema: {
        query: z.string().optional().describe('Words to find anywhere in the message'),
        from: z.string().optional().describe('Sender name or address contains this'),
        subject: z.string().optional().describe('Subject contains this'),
        since: z.string().optional().describe('Received on or after this date, YYYY-MM-DD'),
        before: z.string().optional().describe('Received before this date, YYYY-MM-DD'),
        unreadOnly: z.boolean().optional().describe('Only unread messages'),
        folder,
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(limits.maxResultsCap)
          .optional()
          .describe(`How many messages to list (default ${limits.maxResults})`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      run(async (mail) => {
        const target = args.folder ?? 'INBOX';
        const result = await mail.search(
          target,
          {
            text: args.query?.trim() || undefined,
            from: args.from?.trim() || undefined,
            subject: args.subject?.trim() || undefined,
            since: parseDate(args.since, 'since'),
            before: parseDate(args.before, 'before'),
            unreadOnly: args.unreadOnly,
          },
          args.maxResults ?? limits.maxResults,
        );
        return formatSummaries(target, result);
      }),
  );

  server.registerTool(
    'read_email',
    {
      title: 'Read email',
      description:
        'Open one message by the id from search_emails and return its headers and text (read-only; ' +
        'it is not marked as read).',
      inputSchema: {
        id: z.number().int().positive().describe('Message id from search_emails'),
        folder,
        maxChars: z
          .number()
          .int()
          .min(200)
          .max(limits.maxCharsCap)
          .optional()
          .describe(`Maximum characters of body text (default ${limits.maxChars})`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, folder: name, maxChars }) =>
      run(async (mail) => {
        const target = name ?? 'INBOX';
        const message = await mail.read(target, id);
        if (!message) {
          throw new MailError(`No message with id ${id} in ${target}.`);
        }
        return formatDetail(message, maxChars ?? limits.maxChars);
      }),
  );

  return server;
}
