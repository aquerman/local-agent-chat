import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '~/server';
import { readLimits } from '~/limits';

async function main(): Promise<void> {
  const limits = readLimits(process.env);
  const server = createServer({ limits });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const { maxChars, timeoutMs, maxBytes } = limits;
  process.stderr.write(
    `websearch: ready (maxChars=${maxChars}, timeoutMs=${timeoutMs}, maxBytes=${maxBytes})\n`,
  );
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`websearch: fatal: ${reason}\n`);
  process.exit(1);
});
