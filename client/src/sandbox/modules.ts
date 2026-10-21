/**
 * Packages a React artifact can import when its preview renders on LibreChat's self-hosted
 * bundler (fork: see CLAUDE.md "Artifacts offline"). The build bundles each one into its own
 * lazily loaded chunk under `artifacts-preview/__csb_vendor/react/`, so a preview downloads
 * only what it imports. Mirrors the npm dependencies the online `react-ts` template installs
 * (`getDependencies` in `~/utils/artifacts`), plus the entry points React itself needs.
 */
export const SANDBOX_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'three',
  'three/examples/jsm/controls/OrbitControls',
  'lucide-react',
  'react-router-dom',
  'class-variance-authority',
  'clsx',
  'date-fns',
  'tailwind-merge',
  'recharts',
  '@radix-ui/react-accordion',
  '@radix-ui/react-alert-dialog',
  '@radix-ui/react-aspect-ratio',
  '@radix-ui/react-avatar',
  '@radix-ui/react-checkbox',
  '@radix-ui/react-collapsible',
  '@radix-ui/react-dialog',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-hover-card',
  '@radix-ui/react-label',
  '@radix-ui/react-menubar',
  '@radix-ui/react-navigation-menu',
  '@radix-ui/react-popover',
  '@radix-ui/react-progress',
  '@radix-ui/react-radio-group',
  '@radix-ui/react-select',
  '@radix-ui/react-separator',
  '@radix-ui/react-slider',
  '@radix-ui/react-switch',
  '@radix-ui/react-tabs',
  '@radix-ui/react-toast',
  '@radix-ui/react-slot',
  '@radix-ui/react-toggle',
  '@radix-ui/react-toggle-group',
  '@radix-ui/react-tooltip',
  'embla-carousel-react',
  'react-day-picker',
  'dat.gui',
  'vaul',
] as const;

export type SandboxModule = (typeof SANDBOX_MODULES)[number];

/** Online dependencies with nothing to import at runtime (a Tailwind config plugin). */
export const SANDBOX_SKIPPED_DEPENDENCIES = ['tailwindcss-animate'] as const;

/** The file each specifier imports at build time, where the package's exports map needs the
 *  extension that artifact code usually leaves out. */
export function sandboxImportPath(specifier: SandboxModule): string {
  return specifier.startsWith('three/examples/') ? `${specifier}.js` : specifier;
}

/** Path of the runtime entry on the preview origin. The `/__csb` prefix makes the preview's
 *  service worker pass the request through to LibreChat's server. */
export const SANDBOX_RUNTIME_PATH = '/__csb_vendor/react/runtime.js';

/** Id of the `<script type="application/json">` that carries the artifact's source files. */
export const SANDBOX_FILES_ELEMENT_ID = 'artifact-files';
