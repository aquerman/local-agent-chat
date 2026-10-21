import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCalendarLoader, describeSource, nodeReadFile } from '~/source';
import { createServer } from '~/server';
import { readConfig } from '~/limits';

async function main(): Promise<void> {
  const { sources, timeZone, limits } = readConfig(process.env);
  const load = createCalendarLoader(sources, {
    fetch: globalThis.fetch,
    readFile: nodeReadFile,
    limits,
    now: Date.now,
  });
  const server = createServer({ load, timeZone, limits });
  await server.connect(new StdioServerTransport());
  const described = sources.length === 0 ? 'none' : sources.map(describeSource).join(', ');
  process.stderr.write(`calendar: ready (timeZone=${timeZone}, sources=${described})\n`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`calendar: fatal: ${reason}\n`);
  process.exit(1);
});
