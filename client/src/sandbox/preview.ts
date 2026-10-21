import type { SandpackFiles, SandpackProviderProps } from '@codesandbox/sandpack-react';

/** Sandpack files as `ArtifactPreview` assembles them: plain strings or `{ code }` edits. */
export type PreviewFiles = { [path: string]: string | { code: string } | undefined };
import { SANDBOX_FILES_ELEMENT_ID, SANDBOX_RUNTIME_PATH } from './modules';

const REACT_ENTRY = 'App.tsx';
const PAGE_TEMPLATE = '/public/index.html';
const TAILWIND_CDN_SCRIPT = /<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>\s*/g;

const FALLBACK_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body><div id="root"></div></body>
</html>`;

/**
 * Whether a React artifact can render on LibreChat's self-hosted preview bundler (fork: see
 * CLAUDE.md "Artifacts offline"). `staticSelfHosted` is `resolveStaticBundler(...).selfHosted`:
 * true only when `SANDPACK_STATIC_BUNDLER_URL` points at this server's `*.localhost` host and the
 * page is open on this machine. Otherwise React keeps Sandpack's online `react-ts` bundler.
 */
export function isOfflineReactPreview(
  template: SandpackProviderProps['template'],
  fileKey: string,
  staticSelfHosted: boolean,
): boolean {
  return staticSelfHosted && template === 'react-ts' && fileKey === REACT_ENTRY;
}

const codeOf = (file: PreviewFiles[string]): string =>
  typeof file === 'string' ? file : (file?.code ?? '');

/** Escapes `<` so no file content can close the JSON `<script>` element it is embedded in. */
export const embedJSON = (value: object): string => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Turns a React artifact's Sandpack files into a single `index.html` for the `static`
 * template: the `react-ts` page template without the Tailwind CDN (the static bundler injects
 * the self-hosted Tailwind instead), the source files as embedded JSON, and the runtime that
 * compiles and renders them in the preview (`./runtime.ts`).
 */
export function getOfflineReactFiles(files: PreviewFiles): SandpackFiles {
  const sources = Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => /\.(tsx?|jsx?|css)$/.test(path))
      .map(([path, file]) => [path, codeOf(file)]),
  );
  const template = files[PAGE_TEMPLATE];
  const page = (template != null ? codeOf(template) : FALLBACK_PAGE).replace(
    TAILWIND_CDN_SCRIPT,
    '',
  );
  const scripts =
    `<script type="application/json" id="${SANDBOX_FILES_ELEMENT_ID}">${embedJSON(sources)}</script>\n` +
    `<script type="module" src="${SANDBOX_RUNTIME_PATH}"></script>\n`;
  return { '/index.html': page.replace('</body>', `${scripts}</body>`) };
}
