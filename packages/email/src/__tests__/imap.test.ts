import { ImapFlow } from 'imapflow';
import type { ImapSettings } from '~/limits';
import { createImapStore } from '~/imap';
import { DEFAULT_LIMITS } from '~/limits';

/**
 * Runs against a real IMAP server only when one is provided, e.g. GreenMail:
 *   docker run -d -p 3143:3143 -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all
 *     -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=test:secret' greenmail/standalone:2.1.3
 *   EMAIL_TEST_IMAP_PORT=3143 npx jest imap
 */
const port = Number(process.env.EMAIL_TEST_IMAP_PORT ?? 0);
const maybe = port > 0 ? describe : describe.skip;

const settings: ImapSettings = {
  host: process.env.EMAIL_TEST_IMAP_HOST ?? '127.0.0.1',
  port,
  secure: false,
  user: process.env.EMAIL_TEST_IMAP_USER ?? 'test',
  password: process.env.EMAIL_TEST_IMAP_PASSWORD ?? 'secret',
};
const limits = { ...DEFAULT_LIMITS, timeoutMs: 5000 };

function rfc822(subject: string, from: string, date: string, body: string): string {
  return [
    `From: ${from}`,
    'To: test@localhost',
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: <${subject.replace(/\W/g, '')}.${Date.now()}@fixture>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

maybe('IMAP store (live server)', () => {
  const marker = `run${Date.now()}`;

  beforeAll(async () => {
    const seeder = new ImapFlow({
      ...settings,
      auth: { user: settings.user, pass: settings.password },
      logger: false,
    });
    await seeder.connect();
    await seeder.append(
      'INBOX',
      rfc822(
        `Dentist ${marker}`,
        'Dentist <office@dentist.example>',
        'Mon, 19 Oct 2026 09:30:00 +0200',
        'Thursday at 15:00.',
      ),
    );
    await seeder.append(
      'INBOX',
      rfc822(
        `Newsletter ${marker}`,
        'news@example.com',
        'Tue, 20 Oct 2026 06:00:00 +0000',
        `Weekly ${marker} digest.`,
      ),
    );
    await seeder.logout();
  });

  it('searches newest first and reads without marking as seen', async () => {
    const store = createImapStore(settings, limits);
    const result = await store.search('INBOX', { text: marker }, 10);
    expect(result.total).toBe(2);
    expect(result.messages.map((message) => message.subject)).toEqual([
      `Newsletter ${marker}`,
      `Dentist ${marker}`,
    ]);
    expect(result.messages[0].from).toBe('news@example.com');
    const dentist = result.messages[1];
    expect(dentist.unread).toBe(true);
    expect(dentist.from).toBe('Dentist <office@dentist.example>');

    const opened = await store.read('INBOX', dentist.id);
    expect(opened?.text).toBe('Thursday at 15:00.');
    expect(opened?.subject).toBe(`Dentist ${marker}`);

    const again = await store.search(
      'INBOX',
      { from: 'office@dentist.example', unreadOnly: true },
      10,
    );
    expect(again.messages.map((message) => message.id)).toContain(dentist.id);
  });

  it('lists folders and rejects unknown ones and missing ids', async () => {
    const store = createImapStore(settings, limits);
    expect(await store.listFolders()).toContain('INBOX');
    await expect(store.search('Nope', {}, 5)).rejects.toThrow('No folder named "Nope"');
    expect(await store.read('INBOX', 999999)).toBeNull();
  });

  it('turns a bad password into a readable error', async () => {
    const store = createImapStore({ ...settings, password: 'wrong' }, limits);
    await expect(store.listFolders()).rejects.toThrow(/rejected the login/);
  });
});
