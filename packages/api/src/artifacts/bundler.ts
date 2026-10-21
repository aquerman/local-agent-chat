import fs from 'fs';
import path from 'path';
import express from 'express';
import { logger } from '@librechat/data-schemas';
import type { RequestHandler } from 'express';

export interface StaticBundlerOptions {
  /** `SANDPACK_STATIC_BUNDLER_URL`, e.g. `http://preview.localhost:3080`. */
  bundlerURL?: string;
  /** Directory holding static-browser-server's preview files (`client/dist/artifacts-preview`). */
  root: string;
}

/**
 * Sandpack's static template opens every preview on its own origin, `<id>-<bundler host>`,
 * where `<id>` is the hex id static-browser-server generates. Returns the matcher for those
 * hostnames, or `null` when the bundler URL is unset or not on a `*.localhost` host (the only
 * wildcard name a browser resolves to this machine without DNS).
 */
export function getPreviewHostPattern(bundlerURL?: string): RegExp | null {
  if (!bundlerURL) {
    return null;
  }
  let hostname: string;
  try {
    hostname = new URL(bundlerURL).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname.endsWith('.localhost')) {
    return null;
  }
  const escaped = hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[0-9a-f]+-${escaped}$`);
}

const hostnameOf = (hostHeader: string | undefined): string =>
  (hostHeader ?? '').replace(/:\d+$/, '').toLowerCase();

/**
 * Serves Sandpack's static bundler (the relay page and service worker that render HTML, SVG and
 * Markdown artifacts) from this server, so those previews need no connection to
 * codesandbox.io. Requests are matched by Host header, not path: each preview origin is
 * `<id>-<bundler host>`, and every path on it that the service worker passes through
 * (`/__csb*`) belongs to the bundler. Anything else falls back to the relay's index page, as
 * upstream's hosted bundler does.
 *
 * Register it before the security headers: the preview is framed by the app's origin, which
 * `X-Frame-Options: SAMEORIGIN` would refuse.
 */
export function createStaticBundlerMiddleware({
  bundlerURL,
  root,
}: StaticBundlerOptions): RequestHandler | null {
  const pattern = getPreviewHostPattern(bundlerURL);
  if (!pattern) {
    if (bundlerURL) {
      logger.info(
        `[StaticBundler] SANDPACK_STATIC_BUNDLER_URL="${bundlerURL}" is not a *.localhost URL; not serving it locally.`,
      );
    }
    return null;
  }
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    logger.warn(
      `[StaticBundler] ${root} is missing; run \`npm run build\` so artifact previews can load.`,
    );
  }

  const serveStatic = express.static(root, { fallthrough: true });
  const indexFile = path.join(root, 'index.html');

  return (req, res, next) => {
    if (!pattern.test(hostnameOf(req.headers.host))) {
      next();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).end();
      return;
    }
    serveStatic(req, res, () => {
      res.sendFile(indexFile, (err) => {
        if (err) {
          res.status(404).end();
        }
      });
    });
  };
}
