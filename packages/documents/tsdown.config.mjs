import { defineConfig } from 'tsdown';

/** playwright-core finds its own files on disk at run time, so it cannot be inlined. */
const external = /^playwright-core(\/|$)/;

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  dts: false,
  checks: { circularDependency: true },
  // Bundle every other dependency: the executable runs as a child process and should not depend
  // on the caller's node_modules layout beyond playwright-core.
  deps: { alwaysBundle: (id) => !external.test(id), neverBundle: [external], onlyBundle: false },
});
