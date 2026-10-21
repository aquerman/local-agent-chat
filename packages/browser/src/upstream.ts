import { createRequire } from 'node:module';
import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { BrowserSettings, LaunchOptions } from '~/config';
import type { Upstream } from '~/server';
import { toLaunchOptions, toPlaywrightConfig } from '~/config';

type ContextGetter = NonNullable<Parameters<typeof createConnection>[1]>;
type BrowserContext = Awaited<ReturnType<ContextGetter>>;

interface Chromium {
  launchPersistentContext(userDataDir: string, options: LaunchOptions): Promise<BrowserContext>;
}

/**
 * Playwright as @playwright/mcp itself loads it. The browser context handed to Playwright MCP must
 * come from that same copy, which npm nests under @playwright/mcp (it pins a Playwright build).
 */
function loadChromium(): Chromium {
  const playwright = createRequire(require.resolve('@playwright/mcp'))('playwright') as {
    chromium: Chromium;
  };
  return playwright.chromium;
}

export interface UpstreamConnection {
  upstream: Upstream;
  /** Closes the MCP link and the browser, so the profile is shut down cleanly. */
  close: () => Promise<void>;
}

/**
 * Runs Playwright MCP in this process and talks to it over an in-memory MCP link. This process
 * opens the browser itself (on the first tool call, and again if the user closed the window),
 * because Playwright MCP's API leaves a browser it launched running after the link closes.
 */
export async function connectUpstream(
  settings: BrowserSettings,
  version: string,
): Promise<UpstreamConnection> {
  const chromium = loadChromium();
  let context: BrowserContext | undefined;
  const openContext: ContextGetter = async () => {
    context = await chromium.launchPersistentContext(
      settings.profileDir,
      toLaunchOptions(settings),
    );
    return context;
  };
  const playwright = await createConnection(toPlaywrightConfig(settings), openContext);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await playwright.connect(serverSide);
  const client = new Client({ name: 'librechat-browser', version });
  await client.connect(clientSide);
  return {
    upstream: {
      listTools: async () => (await client.listTools()).tools,
      callTool: async (name, args) =>
        (await client.callTool({ name, arguments: args })) as CallToolResult,
    },
    close: async () => {
      await client.close();
      await context?.close().catch(() => undefined);
    },
  };
}
