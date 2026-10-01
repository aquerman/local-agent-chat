import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '~/server';
import { readLimits } from '~/limits';

async function main(): Promise<void> {
  const limits = readLimits(process.env);
  const server = createServer({ limits });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `websearch: ready (maxChars=${limits.maxChars}, timeoutMs=${limits.timeoutMs})\n`,
  );
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`websearch: fatal: ${reason}\n`);
  process.exit(1);
});
