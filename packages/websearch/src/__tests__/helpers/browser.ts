import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const EXECUTABLES = [
  'chrome-linux/chrome',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win/chrome.exe',
];

function bundledChromium(): string | undefined {
  try {
    const executable = chromium.executablePath();
    return fs.existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

/** Any Chromium under PLAYWRIGHT_BROWSERS_PATH, even a revision other than the one Playwright expects. */
function installedChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) {
    return undefined;
  }
  const dirs = fs
    .readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const found = EXECUTABLES.map((exe) => path.join(root, dir, exe)).find((p) => fs.existsSync(p));
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** A Chromium the render tests can launch, or undefined to skip them. */
export const testBrowserPath: string | undefined =
  process.env.WEBSEARCH_BROWSER_PATH || bundledChromium() || installedChromium();
