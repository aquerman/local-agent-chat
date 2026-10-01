import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_LIMITS } from '~/limits';
import { createServer, formatPage, formatSearch } from '~/server';
import type { FetchFn } from '~/fetch';

const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

const pageText = 'Example page text. '.repeat(20);
const page = `<html><head><title>Example</title></head><body><main><p>${pageText}</p></main></body></html>`;

const routed: FetchFn = (input) => {
  const url = String(input);
  if (url.startsWith('https://html.duckduckgo.com/')) {
    return Promise.resolve(
      new Response(fixture('ddg-results.html'), { headers: { 'content-type': 'text/html' } }),
    );
  }
  if (url === 'https://example.com/first?a=1&b=2') {
    return Promise.resolve(new Response(page, { headers: { 'content-type': 'text/html' } }));
  }
  return Promise.resolve(new Response('nope', { status: 404 }));
};

interface TextResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function connect(fetchFn: FetchFn = routed): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ fetch: fetchFn, limits });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<TextResult> {
  return (await client.callTool({ name, arguments: args })) as TextResult;
}

describe('createServer', () => {
  it('lists search and fetch with descriptions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['fetch', 'search']);
    for (const tool of tools) {
      expect(tool.description).toMatch(/\w+ \w+/);
    }
  });

  it('search returns a numbered list', async () => {
    const client = await connect();
    const result = await call(client, 'search', { query: 'q', maxResults: 2 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe(
      [
        'Results for: q',
        '',
        '1. First & best result',
        '   https://example.com/first?a=1&b=2',
        '   A snippet about the first result.',
        '',
        '2. Second result',
        '   https://second.example.org/page',
        '   Direct link, no redirect wrapper.',
      ].join('\n'),
    );
  });

  it('search reports zero results as a normal result', async () => {
    const empty: FetchFn = () =>
      Promise.resolve(
        new Response(fixture('ddg-empty.html'), { headers: { 'content-type': 'text/html' } }),
      );
    const client = await connect(empty);
    const result = await call(client, 'search', { query: 'zzz' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('No results for: zzz');
  });

  it('fetch returns title, url and text', async () => {
    const client = await connect();
    const result = await call(client, 'fetch', {
      url: 'https://example.com/first?a=1&b=2',
      maxChars: 50,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe(
      `Example\nhttps://example.com/first?a=1&b=2\n\n${pageText.trim().slice(0, 50)}\n\n[truncated at 50 chars]`,
    );
  });

  it('turns a WebSearchError into an isError text result', async () => {
    const client = await connect();
    const result = await call(client, 'fetch', { url: 'http://127.0.0.1:27017/' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Refused to fetch http://127.0.0.1:27017/: loopback, link-local and private hosts are blocked',
    );
  });

  it('turns an HTTP failure into an isError text result', async () => {
    const client = await connect();
    const result = await call(client, 'fetch', { url: 'https://example.com/missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Fetch failed: HTTP 404');
  });

  it('rejects out-of-range arguments at the schema', async () => {
    const client = await connect();
    const result = await call(client, 'search', { query: 'q', maxResults: 50 });
    expect(result.isError).toBe(true);
  });
});

describe('formatters', () => {
  it('formatSearch handles an empty snippet', () => {
    expect(formatSearch('q', [{ title: 'T', url: 'https://t.example/', snippet: '' }])).toBe(
      'Results for: q\n\n1. T\n   https://t.example/',
    );
  });

  it('formatPage appends the JavaScript hint', () => {
    expect(
      formatPage({
        url: 'https://x.example/',
        title: 'X',
        text: 'short',
        truncated: false,
        hint: 'Page content appears to require JavaScript.',
      }),
    ).toBe('X\nhttps://x.example/\n\nshort\n\nPage content appears to require JavaScript.');
  });
});
