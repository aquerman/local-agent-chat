import JSZip from 'jszip';
import { readBrowser } from '~/config';
import type { Config } from '~/config';

/** The browser the PDF tests print with: DOCUMENTS_BROWSER_PATH / _CHANNEL, else the platform default. */
export const testBrowser = readBrowser(process.env, process.platform);

export function testConfig(outputDir: string): Config {
  return { outputDir, pageSize: 'A4', browser: testBrowser, maxBytes: 20_000_000, maxParts: 50 };
}

export async function zipText(file: Buffer, pattern: RegExp): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((name) => pattern.test(name));
  const entries = await Promise.all(
    names.map(async (name) => [name, await zip.file(name)!.async('string')] as const),
  );
  return Object.fromEntries(entries);
}
