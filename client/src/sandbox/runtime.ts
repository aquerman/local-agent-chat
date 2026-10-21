import { transform } from 'sucrase';
import type * as ReactDOMClient from 'react-dom/client';
import type * as React from 'react';
import { SANDBOX_FILES_ELEMENT_ID } from './modules';

/**
 * In-browser module runtime for React artifacts on LibreChat's self-hosted preview bundler
 * (fork: see CLAUDE.md "Artifacts offline"). It runs inside the preview iframe instead of
 * Sandpack's online React bundler: sucrase strips TypeScript and JSX from the artifact's files,
 * a small CommonJS loader links them, and packages come from chunks the build vendored from
 * npm (`SANDBOX_MODULES`). Nothing is fetched from outside LibreChat's server.
 */

/** Exports object of a linked module, CommonJS-shaped as sucrase's import transform expects. */
export type ModuleExports = { [name: string]: unknown };

/** Lazy loaders for the vendored packages, keyed by import specifier. */
export type ModuleLoaders = { [specifier: string]: () => Promise<ModuleExports> };

export type ResolvedImport = { kind: 'file'; path: string } | { kind: 'package'; name: string };

export interface CompiledModule {
  code: string;
  imports: Map<string, ResolvedImport>;
}

export interface ModuleGraph {
  modules: Map<string, CompiledModule>;
  packages: Map<string, ModuleExports>;
}

const SCRIPT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const CANDIDATE_SUFFIXES = [
  '',
  ...SCRIPT_EXTENSIONS,
  '.css',
  ...SCRIPT_EXTENSIONS.map((extension) => `/index${extension}`),
];
export const ENTRY_CANDIDATES = ['/App.tsx', '/App.jsx', '/App.ts', '/App.js', '/index.tsx'];
const RENDER_PACKAGES = ['react', 'react-dom/client'];
const REQUIRE_PATTERN = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;

const isFileSpecifier = (specifier: string): boolean =>
  specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/');

/** Keys every file by an absolute path, the way Sandpack names them (`App.tsx` → `/App.tsx`). */
export function normalizeFiles(files: { [path: string]: string }): Map<string, string> {
  return new Map(
    Object.entries(files).map(([path, code]) => [path.startsWith('/') ? path : `/${path}`, code]),
  );
}

/** Maps the spellings artifact code uses for a vendored package onto its `SANDBOX_MODULES`
 *  name: no `.js` extension, and three's `addons/` alias for `examples/jsm/`. */
export function normalizePackageSpecifier(specifier: string): string {
  const bare = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
  return bare.startsWith('three/addons/')
    ? `three/examples/jsm/${bare.slice('three/addons/'.length)}`
    : bare;
}

function joinPath(directory: string, relative: string): string {
  const segments = `${directory}/${relative}`.split('/').reduce<string[]>((acc, segment) => {
    if (segment === '' || segment === '.') {
      return acc;
    }
    if (segment === '..') {
      return acc.slice(0, -1);
    }
    return [...acc, segment];
  }, []);
  return `/${segments.join('/')}`;
}

/** Resolves a relative, absolute or `@/`-aliased import against the artifact's files. */
export function resolveFile(
  specifier: string,
  importer: string,
  files: Map<string, string>,
): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = `/${specifier.slice(2)}`;
  } else if (specifier.startsWith('/')) {
    base = specifier;
  } else {
    base = joinPath(importer.slice(0, importer.lastIndexOf('/')), specifier);
  }
  const match = CANDIDATE_SUFFIXES.map((suffix) => base + suffix).find((path) => files.has(path));
  return match ?? null;
}

/** Specifiers of every `require(...)` in sucrase's CommonJS output, in order, without repeats. */
export function findRequires(code: string): string[] {
  return [...new Set(Array.from(code.matchAll(REQUIRE_PATTERN), (match) => match[2]))];
}

function compileSource(path: string, source: string): string {
  if (path.endsWith('.css')) {
    return `var style = document.createElement('style');
style.textContent = ${JSON.stringify(source)};
document.head.appendChild(style);`;
  }
  return transform(source, {
    transforms: ['typescript', 'jsx', 'imports'],
    jsxRuntime: 'automatic',
    production: true,
    filePath: path,
  }).code;
}

/**
 * Wraps a vendored chunk's ES module namespace for sucrase's interop helpers: `__esModule`
 * keeps `import X from` on the real default export, and a CommonJS package's own properties
 * (React's `useState`) become named exports, as a bundler would expose them.
 */
export function toModuleExports(namespace: ModuleExports): ModuleExports {
  const fallback = namespace.default;
  const fromDefault =
    fallback != null && (typeof fallback === 'object' || typeof fallback === 'function')
      ? { ...(fallback as ModuleExports) }
      : {};
  return { ...fromDefault, ...namespace, __esModule: true };
}

/**
 * Compiles every file reachable from `entry` and loads the vendored packages they import, all
 * packages in parallel. Throws, before running any artifact code, on a missing file or a
 * package that is not vendored.
 */
export async function loadGraph(
  files: Map<string, string>,
  entry: string,
  loaders: ModuleLoaders,
  preload: string[] = [],
): Promise<ModuleGraph> {
  const modules = new Map<string, CompiledModule>();
  const pending = new Map<string, Promise<ModuleExports>>();

  const requestPackage = (name: string, specifier: string): void => {
    if (pending.has(name)) {
      return;
    }
    const loader = loaders[name];
    if (!loader) {
      throw new Error(
        `The package "${specifier}" is not available offline. Offline previews can import: ${Object.keys(loaders).join(', ')}.`,
      );
    }
    pending.set(name, loader().then(toModuleExports));
  };

  const resolveImport = (specifier: string, importer: string): ResolvedImport => {
    if (!isFileSpecifier(specifier)) {
      const name = normalizePackageSpecifier(specifier);
      requestPackage(name, specifier);
      return { kind: 'package', name };
    }
    const path = resolveFile(specifier, importer, files);
    if (!path) {
      throw new Error(`Cannot find "${specifier}", imported by ${importer}.`);
    }
    visit(path);
    return { kind: 'file', path };
  };

  function visit(path: string): void {
    if (modules.has(path)) {
      return;
    }
    const code = compileSource(path, files.get(path) ?? '');
    const imports = new Map<string, ResolvedImport>();
    modules.set(path, { code, imports });
    for (const specifier of findRequires(code)) {
      imports.set(specifier, resolveImport(specifier, path));
    }
  }

  preload.forEach((name) => requestPackage(name, name));
  visit(entry);

  const names = [...pending.keys()];
  const loaded = await Promise.all(pending.values());
  return { modules, packages: new Map(names.map((name, i) => [name, loaded[i]])) };
}

/** Runs the entry module and the files it imports, CommonJS style, and returns its exports. */
export function execute(graph: ModuleGraph, entry: string): ModuleExports {
  const cache = new Map<string, { exports: ModuleExports }>();

  const run = (path: string): ModuleExports => {
    const cached = cache.get(path);
    if (cached) {
      return cached.exports;
    }
    const compiled = graph.modules.get(path);
    if (!compiled) {
      throw new Error(`Module ${path} was not compiled.`);
    }
    const module = { exports: {} as ModuleExports };
    cache.set(path, module);
    const require = (specifier: string): ModuleExports => {
      const resolved = compiled.imports.get(specifier);
      if (!resolved) {
        throw new Error(`Cannot find "${specifier}", imported by ${path}.`);
      }
      if (resolved.kind === 'file') {
        return run(resolved.path);
      }
      return graph.packages.get(resolved.name) ?? {};
    };
    const factory = new Function(
      'require',
      'module',
      'exports',
      `${compiled.code}\n//# sourceURL=${path}`,
    );
    factory(require, module, module.exports);
    return module.exports;
  };

  return run(entry);
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const overlay = document.createElement('pre');
  overlay.setAttribute('role', 'alert');
  overlay.style.cssText =
    'position:fixed;inset:0;margin:0;padding:16px;overflow:auto;white-space:pre-wrap;' +
    'font:13px/1.5 ui-monospace,monospace;background:#fff5f5;color:#b91c1c;z-index:2147483647';
  overlay.textContent = message;
  document.body.appendChild(overlay);
}

/** Reads the artifact's files from the page, links them and renders the default export of
 *  `/App.tsx` into `#root`, as Sandpack's `react-ts` template does. */
export async function start(loaders: ModuleLoaders): Promise<void> {
  window.addEventListener('error', (event) => showError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => showError(event.reason));
  try {
    const element = document.getElementById(SANDBOX_FILES_ELEMENT_ID);
    const files = normalizeFiles(JSON.parse(element?.textContent ?? '{}'));
    const entry = ENTRY_CANDIDATES.find((path) => files.has(path));
    if (!entry) {
      throw new Error('The artifact has no App.tsx to render.');
    }
    const graph = await loadGraph(files, entry, loaders, RENDER_PACKAGES);
    const exports = execute(graph, entry);
    const App = (exports.default ?? exports.App) as React.ComponentType | undefined;
    if (App == null) {
      return;
    }
    const { createElement } = graph.packages.get('react') as Pick<typeof React, 'createElement'>;
    const { createRoot } = graph.packages.get('react-dom/client') as Pick<
      typeof ReactDOMClient,
      'createRoot'
    >;
    const root =
      document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
    createRoot(root).render(createElement(App));
  } catch (error) {
    showError(error);
  }
}
