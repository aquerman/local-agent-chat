import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  dts: false,
  checks: { circularDependency: true },
  // Bundle the MCP SDK so the executable does not depend on the caller's node_modules layout.
  // @playwright/mcp and Playwright are the exception: they find their driver files and the
  // browser registry on disk, so they load from node_modules at runtime.
  deps: {
    alwaysBundle: (id) => !/^(@playwright\/mcp|playwright|playwright-core)(\/|$)/.test(id),
    neverBundle: [/^@playwright\/mcp(\/|$)/, /^playwright(-core)?(\/|$)/],
    onlyBundle: false,
  },
});
