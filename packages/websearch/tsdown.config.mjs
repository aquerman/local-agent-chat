import { defineConfig } from 'tsdown';

const isPlaywright = (id) => id === 'playwright-core' || id.startsWith('playwright-core/');

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  dts: false,
  checks: { circularDependency: true },
  // Bundle every dependency: the executable runs as a child process and must not rely on
  // the caller's node_modules layout. playwright-core is the exception: it locates its own
  // driver files and browser registry on disk, so it is loaded from node_modules at runtime.
  deps: {
    alwaysBundle: (id) => !isPlaywright(id),
    neverBundle: [/^playwright-core(\/|$)/],
    onlyBundle: false,
  },
});
