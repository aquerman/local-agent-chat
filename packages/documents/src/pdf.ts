import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import type { BrowserOptions, PageSize } from '~/config';
import { DocumentsError } from '~/errors';
import { buildHtml } from '~/html';
import { THEME } from '~/theme';

export type LaunchBrowser = (options: BrowserOptions) => Promise<Browser>;

export const launchChromium: LaunchBrowser = (options) =>
  chromium.launch({ headless: true, ...options });

export interface PdfInput {
  title: string;
  sections: string[];
  pageSize: PageSize;
  browser: BrowserOptions;
  launch?: LaunchBrowser;
}

const FOOTER = `<div style="width:100%;text-align:center;font-size:8pt;color:#${THEME.mutedColor};font-family:${THEME.cssBodyFont}"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

function describeBrowser(options: BrowserOptions): string {
  if (options.executablePath !== undefined) {
    return `the browser at DOCUMENTS_BROWSER_PATH (${options.executablePath})`;
  }
  if (options.channel !== undefined) {
    return `the installed "${options.channel}" browser`;
  }
  return "Playwright's Chromium";
}

async function openBrowser(options: BrowserOptions, launch: LaunchBrowser): Promise<Browser> {
  try {
    return await launch(options);
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new DocumentsError(
      `PDF rendering needs a Chromium-based browser and could not start ${describeBrowser(options)}: ${reason}. ` +
        'Set DOCUMENTS_BROWSER_PATH to a Chrome or Edge executable, or DOCUMENTS_BROWSER_CHANNEL (msedge, chrome).',
    );
  }
}

/** Counts the pages of a PDF Chromium printed (it writes one `/Type /Page` object per page). */
export function countPdfPages(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
}

/**
 * Prints the Markdown to PDF in headless Chromium. Scripts are off and every request is refused,
 * so the page cannot reach the network: what the model wrote is all that ends up in the file.
 */
export async function renderPdf({
  title,
  sections,
  pageSize,
  browser: options,
  launch = launchChromium,
}: PdfInput): Promise<Buffer> {
  const browser = await openBrowser(options, launch);
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(buildHtml(title, sections), { waitUntil: 'load' });
    return await page.pdf({
      format: pageSize,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER,
      margin: { top: '22mm', bottom: '22mm', left: '20mm', right: '20mm' },
    });
  } finally {
    await browser.close();
  }
}
