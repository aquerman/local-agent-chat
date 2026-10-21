import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { UpstreamConnection } from '~/upstream';
import type { BrowserSettings } from '~/config';
import { callThroughProxy } from '~/server';
import { connectUpstream } from '~/upstream';
import { EXPOSED_TOOLS } from '~/tools';
import { toRule } from '~/origins';

/** A Chromium to drive: BROWSER_EXECUTABLE_PATH, or the newest one in PLAYWRIGHT_BROWSERS_PATH. */
function findChromium(): string | undefined {
  if (process.env.BROWSER_EXECUTABLE_PATH) {
    return process.env.BROWSER_EXECUTABLE_PATH;
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) {
    return undefined;
  }
  return fs
    .readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()
    .map((name) => path.join(root, name, 'chrome-linux', 'chrome'))
    .find((file) => fs.existsSync(file));
}

const chromium = findChromium();
const describeWithBrowser = chromium ? describe : describe.skip;

const PAGE = `<!doctype html><title>Shop</title><h1>Shop</h1>
<label>Name <input></label><button onclick="document.querySelector('p').textContent='Thanks'">Go</button><p></p>
<a href="/away">Away</a>
<ul>${Array.from({ length: 400 }, (_, i) => `<li>Item ${i}</li>`).join('')}</ul>`;

function textOf(result: CallToolResult): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
}

describeWithBrowser('callThroughProxy with Playwright MCP and a real Chromium', () => {
  let site: http.Server;
  let port: number;
  let connection: UpstreamConnection;
  let profileDir: string;

  beforeAll(async () => {
    site = http.createServer((req, res) => {
      if (req.url === '/away') {
        res.writeHead(302, { location: `http://localhost:${port}/` }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    port = (site.address() as AddressInfo).port;
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profile-'));
    const settings: BrowserSettings = {
      allowedOrigins: [`http://127.0.0.1:${port}`],
      profileDir,
      executablePath: chromium,
      headless: true,
      sandbox: process.getuid?.() !== 0,
      maxChars: 2000,
    };
    connection = await connectUpstream(settings, 'test');
  });

  afterAll(async () => {
    await connection?.close();
    site.closeAllConnections();
    await new Promise((resolve) => site.close(resolve));
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  const call = (name: string, args: Record<string, unknown> = {}) =>
    callThroughProxy(
      {
        upstream: connection.upstream,
        rules: [toRule(`http://127.0.0.1:${port}`)],
        maxChars: 2000,
      },
      name,
      args,
    );

  it('lists every exposed tool, so a Playwright MCP upgrade that renames one fails here', async () => {
    const names = new Set((await connection.upstream.listTools()).map((tool) => tool.name));
    for (const name of EXPOSED_TOOLS) {
      expect(names.has(name)).toBe(true);
    }
    expect(names.has('browser_evaluate')).toBe(true);
  });

  it('navigates, caps the snapshot, finds text and acts on refs', async () => {
    const opened = await call('browser_navigate', { url: `http://127.0.0.1:${port}/` });
    expect(textOf(opened)).toContain('Page Title: Shop');
    expect(textOf(opened)).not.toContain('Snapshot');

    const snapshot = await call('browser_snapshot');
    expect(textOf(snapshot).length).toBeLessThan(2400);
    expect(textOf(snapshot)).toMatch(/Cut at \d+ of \d+ characters/);
    const button = textOf(snapshot).match(/button "Go" \[ref=(\w+)\]/)?.[1];
    expect(button).toBeDefined();

    const clicked = await call('browser_click', { element: 'Go', target: button });
    expect(clicked.isError).toBeFalsy();
    expect(textOf(await call('browser_find', { text: 'Thanks' }))).toContain('Thanks');
  });

  it('refuses a site that is not allowed without opening it', async () => {
    const result = await call('browser_navigate', { url: 'https://example.com/' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('https://example.com is not on the user');
  });

  it('clears a page that redirected outside the allow-list', async () => {
    const result = await call('browser_navigate', { url: `http://127.0.0.1:${port}/away` });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`moved to http://localhost:${port}`);
    const after = await call('browser_snapshot');
    expect(textOf(after)).toContain('Page URL: about:blank');
  });

  it('refuses hidden tools and drops the filename argument', async () => {
    const evaluated = await call('browser_evaluate', { function: '() => 1' });
    expect(textOf(evaluated)).toBe('Unknown tool: browser_evaluate');
    await call('browser_navigate', { url: `http://127.0.0.1:${port}/` });
    const found = await call('browser_find', { text: 'Item 7', filename: 'out.yml' });
    expect(textOf(found)).toContain('Item 7');
    expect(fs.existsSync(path.join(process.cwd(), 'out.yml'))).toBe(false);
  });
});
