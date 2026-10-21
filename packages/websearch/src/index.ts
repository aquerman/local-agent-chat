import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBrowserPool, readRenderConfig } from '~/browser';
import { createServer } from '~/server';
import { readLimits } from '~/limits';

async function main(): Promise<void> {
  const limits = readLimits(process.env);
  const renderConfig = readRenderConfig(process.env);
  const browsers = createBrowserPool(renderConfig, limits.timeoutMs);
  const server = createServer({ limits, render: { mode: renderConfig.mode, browsers } });
  const transport = new StdioServerTransport();
  process.stdin.on('end', () => {
    void browsers.close().finally(() => process.exit(0));
  });
  await server.connect(transport);
  const { maxChars, timeoutMs, maxBytes } = limits;
  process.stderr.write(
    `websearch: ready (maxChars=${maxChars}, timeoutMs=${timeoutMs}, maxBytes=${maxBytes}, render=${renderConfig.mode})\n`,
  );
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`websearch: fatal: ${reason}\n`);
  process.exit(1);
});
