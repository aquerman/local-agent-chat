import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  dts: false,
  checks: { circularDependency: true },
  // Bundle every dependency: the executable runs as a child process and must not rely on
  // the caller's node_modules layout.
  deps: { alwaysBundle: () => true, onlyBundle: false },
});
