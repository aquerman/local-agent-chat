import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '~/server';
import { readConfig } from '~/config';

function describeBrowser(config: ReturnType<typeof readConfig>): string {
  const { executablePath, channel } = config.browser;
  return executablePath ?? channel ?? 'playwright-chromium';
}

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const server = createServer({ config });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `documents: ready (dir=${config.outputDir}, pageSize=${config.pageSize}, pdfBrowser=${describeBrowser(config)})\n`,
  );
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`documents: fatal: ${reason}\n`);
  process.exit(1);
});
