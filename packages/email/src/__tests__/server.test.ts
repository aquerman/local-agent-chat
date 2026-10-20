import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { MessageDetail, MailStore, SearchCriteria } from '~/store';
import { DEFAULT_LIMITS, readConfig } from '~/limits';
import { createServer } from '~/server';
import { MailError } from '~/store';

interface TextResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const detail: MessageDetail = {
  id: 42,
  date: new Date('2026-10-19T07:30:00Z'),
  from: 'Dentist Office <office@dentist.example>',
  to: 'me@example.com',
  cc: '',
  subject: 'Appointment reminder',
  text: 'Your appointment is on Thursday at 15:00.\r\n\r\n\r\n\r\nSee you then. '.repeat(10),
  attachments: ['directions.pdf'],
};

/** A substitute at the IMAP boundary; the real store is exercised in imap.test.ts. */
function fakeStore(calls: Array<[string, SearchCriteria, number]>): MailStore {
  return {
    listFolders: async () => ['INBOX', 'Archive', '[Gmail]/Sent Mail'],
    search: async (folder, criteria, limit) => {
      calls.push([folder, criteria, limit]);
      return {
        total: 12,
        messages: [
          {
            id: 42,
            date: detail.date,
            from: detail.from,
            subject: detail.subject,
            unread: true,
          },
          { id: 40, date: undefined, from: 'news@example.com', subject: '', unread: false },
        ],
      };
    },
    read: async (folder, id) => {
      if (folder !== 'INBOX') {
        throw new MailError(
          `No folder named "${folder}". Use list_folders to see the folder names.`,
        );
      }
      return id === 42 ? detail : null;
    },
  };
}

async function connect(store: MailStore | undefined): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ store, limits: DEFAULT_LIMITS }).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as TextResult;
  return { text: result.content.map((part) => part.text ?? '').join('\n'), error: result.isError };
}

describe('email MCP server', () => {
  it('offers only read-only tools, with no way to send or change mail', async () => {
    const { tools } = await (await connect(fakeStore([]))).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'list_folders',
      'read_email',
      'search_emails',
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('passes filters through and lists newest matches', async () => {
    const calls: Array<[string, SearchCriteria, number]> = [];
    const client = await connect(fakeStore(calls));
    const { text, error } = await call(client, 'search_emails', {
      query: ' appointment ',
      from: 'dentist',
      since: '2026-10-01',
      unreadOnly: true,
      maxResults: 2,
    });
    expect(error).toBeFalsy();
    expect(calls).toEqual([
      [
        'INBOX',
        {
          text: 'appointment',
          from: 'dentist',
          subject: undefined,
          since: new Date('2026-10-01T00:00:00Z'),
          before: undefined,
          unreadOnly: true,
        },
        2,
      ],
    ]);
    expect(text.split('\n')).toEqual([
      '12 messages in INBOX match; newest 2:',
      '- id 42 | 2026-10-19 07:30 UTC | Dentist Office <office@dentist.example> [unread]',
      '  Appointment reminder',
      '- id 40 | no date | news@example.com',
      '  (no subject)',
      'Use read_email with an id to open one.',
    ]);
  });

  it('reads one message with headers, attachments and a capped body', async () => {
    const client = await connect(fakeStore([]));
    const { text } = await call(client, 'read_email', { id: 42, maxChars: 200 });
    const lines = text.split('\n');
    expect(lines.slice(0, 5)).toEqual([
      'From: Dentist Office <office@dentist.example>',
      'To: me@example.com',
      'Date: 2026-10-19 07:30 UTC',
      'Subject: Appointment reminder',
      'Attachments: directions.pdf',
    ]);
    expect(text).not.toContain('\n\n\n');
    expect(text).toContain('[truncated at 200 chars]');
  });

  it('reports a missing message, a bad folder and a bad date as tool errors', async () => {
    const client = await connect(fakeStore([]));
    const missing = await call(client, 'read_email', { id: 7 });
    expect(missing).toEqual({ text: 'No message with id 7 in INBOX.', error: true });
    const folder = await call(client, 'read_email', { id: 42, folder: 'Nope' });
    expect(folder.error).toBe(true);
    expect(folder.text).toContain('list_folders');
    const date = await call(client, 'search_emails', { since: 'last week' });
    expect(date).toEqual({ text: '"since" must be a date like 2026-10-20.', error: true });
  });

  it('lists folders', async () => {
    const { text } = await call(await connect(fakeStore([])), 'list_folders', {});
    expect(text).toBe('INBOX\nArchive\n[Gmail]/Sent Mail');
  });

  it('explains how to connect when no credentials are set', async () => {
    const { text, error } = await call(await connect(undefined), 'search_emails', {});
    expect(error).toBe(true);
    expect(text).toContain('No mailbox is connected');
  });
});

describe('readConfig', () => {
  it('stays disconnected while any per-user setting is an unfilled placeholder', () => {
    expect(
      readConfig({
        EMAIL_IMAP_HOST: 'imap.gmail.com',
        EMAIL_USER: '{{EMAIL_USER}}',
        EMAIL_PASSWORD: 'secret',
      }).imap,
    ).toBeUndefined();
  });

  it('defaults to implicit TLS on 993, or 143 when TLS is off', () => {
    const base = { EMAIL_IMAP_HOST: 'imap.example.com', EMAIL_USER: 'me', EMAIL_PASSWORD: 'pw' };
    expect(readConfig(base).imap).toEqual({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      user: 'me',
      password: 'pw',
    });
    expect(readConfig({ ...base, EMAIL_IMAP_SECURE: 'false' }).imap?.port).toBe(143);
    expect(readConfig({ ...base, EMAIL_IMAP_PORT: '{{EMAIL_IMAP_PORT}}' }).imap?.port).toBe(993);
  });
});
