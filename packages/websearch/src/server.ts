import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PageContent, FetchFn } from '~/fetch';
import type { SearchResult } from '~/search';
import type { Limits } from '~/limits';
import type { Resolver } from '~/guard';
import { WebSearchError } from '~/errors';
import { fetchPage } from '~/fetch';
import { search } from '~/search';

export interface ServerOptions {
  fetch?: FetchFn;
  resolve?: Resolver;
  limits: Limits;
}

const SEARCH_DESCRIPTION =
  'Search the web with DuckDuckGo. Returns a numbered list of results with title, URL and snippet. ' +
  'Use this first to find pages; then call fetch on the most relevant URL to read it before answering.';

const FETCH_DESCRIPTION =
  'Download a web page and return its readable text (title, URL, then the main content). ' +
  'Use it on a URL from search results before answering from that page. ' +
  'Only http and https URLs on public hosts are allowed.';

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function error(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof WebSearchError) {
    return err.message;
  }
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`websearch: unexpected error: ${reason}\n`);
  return `${fallback}: ${reason}`;
}

export function formatSearch(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results for: ${query}`;
  }
  const lines = results.map((result, index) => {
    const head = `${index + 1}. ${result.title}\n   ${result.url}`;
    return result.snippet === '' ? head : `${head}\n   ${result.snippet}`;
  });
  return [`Results for: ${query}`, ...lines].join('\n\n');
}

export function formatPage(page: PageContent): string {
  const parts = [`${page.title}\n${page.url}`, page.text];
  if (page.truncated) {
    parts.push(`[truncated at ${page.text.length} chars]`);
  }
  if (page.hint !== undefined) {
    parts.push(page.hint);
  }
  return parts.join('\n\n');
}

export function createServer(options: ServerOptions): McpServer {
  const { limits } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const { resolve } = options;
  const server = new McpServer({ name: 'librechat-websearch', version: '0.1.0' });

  server.registerTool(
    'search',
    {
      title: 'Web search',
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).describe('What to search for'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(limits.maxResultsCap)
          .optional()
          .describe(`How many results to return (default ${limits.maxResults})`),
      },
    },
    async ({ query, maxResults }) => {
      try {
        const results = await search(query, { fetch: fetchFn, limits, maxResults });
        return text(formatSearch(query, results));
      } catch (err) {
        return error(toMessage(err, 'Search failed'));
      }
    },
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch page',
      description: FETCH_DESCRIPTION,
      inputSchema: {
        url: z.string().min(1).describe('The http or https URL to read'),
        maxChars: z
          .number()
          .int()
          .min(1)
          .max(limits.maxCharsCap)
          .optional()
          .describe(`Maximum characters of page text to return (default ${limits.maxChars})`),
      },
    },
    async ({ url, maxChars }) => {
      try {
        const page = await fetchPage(url, { fetch: fetchFn, resolve, limits, maxChars });
        return text(formatPage(page));
      } catch (err) {
        return error(toMessage(err, 'Fetch failed'));
      }
    },
  );

  return server;
}
