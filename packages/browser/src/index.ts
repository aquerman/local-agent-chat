import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createProxyServer } from '~/server';
import { connectUpstream } from '~/upstream';
import { readSettings } from '~/config';
import { toRule } from '~/origins';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const settings = readSettings(process.env);
  const { upstream, close } = await connectUpstream(settings, VERSION);
  const server = createProxyServer(
    { upstream, rules: settings.allowedOrigins.map(toRule), maxChars: settings.maxChars },
    VERSION,
  );
  process.stdin.on('end', () => {
    void close().finally(() => process.exit(0));
  });
  await server.connect(new StdioServerTransport());
  const browser = settings.executablePath ?? settings.channel ?? 'Playwright Chromium';
  const sites = settings.allowedOrigins.length > 0 ? settings.allowedOrigins.join(' ') : 'none';
  process.stderr.write(
    `browser: ready (browser=${browser}, headless=${settings.headless}, allowed=${sites}, maxChars=${settings.maxChars})\n`,
  );
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser: fatal: ${reason}\n`);
  process.exit(1);
});
