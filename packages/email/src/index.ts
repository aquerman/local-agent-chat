import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createImapStore } from '~/imap';
import { createServer } from '~/server';
import { readConfig } from '~/limits';

async function main(): Promise<void> {
  const { imap, limits } = readConfig(process.env);
  const store = imap ? createImapStore(imap, limits) : undefined;
  const server = createServer({ store, limits });
  await server.connect(new StdioServerTransport());
  const target = imap ? `${imap.host}:${imap.port}` : 'not connected';
  process.stderr.write(`email: ready (read-only, ${target})\n`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`email: fatal: ${reason}\n`);
  process.exit(1);
});
