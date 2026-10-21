import { loader } from '@monaco-editor/react';

/** Where the production build serves Monaco's AMD files (`copyArtifactRuntime` in vite.config.ts). */
export function getMonacoBaseURL(baseURI: string): string {
  return new URL('monaco/vs', baseURI).href;
}

/**
 * Points `@monaco-editor/react` at the Monaco copy LibreChat serves itself instead of jsDelivr,
 * so the artifact Code tab works offline. The Vite dev server has no copy, so development keeps
 * the CDN default.
 */
export function configureMonacoLoader(isProduction: boolean = import.meta.env.PROD): void {
  if (!isProduction) {
    return;
  }
  loader.config({ paths: { vs: getMonacoBaseURL(document.baseURI) } });
}
