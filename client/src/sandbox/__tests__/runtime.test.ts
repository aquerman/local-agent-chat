import { shadcnComponents } from 'librechat-data-provider';
import type { ModuleLoaders } from '../runtime';
import {
  start,
  execute,
  loadGraph,
  resolveFile,
  findRequires,
  normalizeFiles,
  toModuleExports,
  normalizePackageSpecifier,
} from '../runtime';
import { SANDBOX_FILES_ELEMENT_ID } from '../modules';

const loaders: ModuleLoaders = {
  react: () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react-dom/client': () => import('react-dom/client'),
  clsx: () => import('clsx'),
  'tailwind-merge': () => import('tailwind-merge'),
  'class-variance-authority': () => import('class-variance-authority'),
  '@radix-ui/react-slot': () => import('@radix-ui/react-slot'),
  'lucide-react': () => import('lucide-react'),
};

const counterApp = `import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '/components/ui/button';

type Props = { start?: number };

export default function App({ start = 2 }: Props) {
  const [count, setCount] = useState<number>(start);
  return (
    <div className="p-4">
      <Button onClick={() => setCount(count + 1)}><Plus size={16} /> Add</Button>
      <span data-testid="count">{count}</span>
    </div>
  );
}
`;

const shadcnFiles = {
  '/lib/utils.ts': shadcnComponents.utils,
  '/components/ui/button.tsx': shadcnComponents.button,
};

describe('sandbox runtime helpers', () => {
  it('normalizes file keys and package spellings', () => {
    expect([...normalizeFiles({ 'App.tsx': 'a', '/lib/utils.ts': 'b' }).keys()]).toEqual([
      '/App.tsx',
      '/lib/utils.ts',
    ]);
    expect(normalizePackageSpecifier('three/addons/controls/OrbitControls.js')).toBe(
      'three/examples/jsm/controls/OrbitControls',
    );
    expect(normalizePackageSpecifier('recharts')).toBe('recharts');
  });

  it('resolves relative, absolute and @/ imports with implicit extensions', () => {
    const files = normalizeFiles({ ...shadcnFiles, 'App.tsx': '', '/styles.css': '' });
    expect(resolveFile('../../lib/utils', '/components/ui/button.tsx', files)).toBe(
      '/lib/utils.ts',
    );
    expect(resolveFile('/components/ui/button', '/App.tsx', files)).toBe(
      '/components/ui/button.tsx',
    );
    expect(resolveFile('@/components/ui/button', '/App.tsx', files)).toBe(
      '/components/ui/button.tsx',
    );
    expect(resolveFile('./styles.css', '/App.tsx', files)).toBe('/styles.css');
    expect(resolveFile('./missing', '/App.tsx', files)).toBeNull();
  });

  it('lists required specifiers once each', () => {
    expect(
      findRequires(`var a = require('react'); var b = require("./x"); require('react');`),
    ).toEqual(['react', './x']);
  });

  it('exposes a CommonJS package both as default and as named exports', () => {
    const cjs = { useState: jest.fn() };
    const wrapped = toModuleExports({ default: cjs });
    expect(wrapped.default).toBe(cjs);
    expect(wrapped.useState).toBe(cjs.useState);
    expect(wrapped.__esModule).toBe(true);
  });
});

describe('loadGraph and execute', () => {
  it('compiles TSX with shadcn components and runs it against vendored packages', async () => {
    const files = normalizeFiles({ 'App.tsx': counterApp, ...shadcnFiles });
    const graph = await loadGraph(files, '/App.tsx', loaders);
    expect([...graph.modules.keys()]).toEqual([
      '/App.tsx',
      '/components/ui/button.tsx',
      '/lib/utils.ts',
    ]);
    expect([...graph.packages.keys()]).toEqual(
      expect.arrayContaining(['react', 'react/jsx-runtime', 'lucide-react', 'tailwind-merge']),
    );
    const exports = execute(graph, '/App.tsx');
    expect(typeof exports.default).toBe('function');
  });

  it('rejects a package that is not vendored before running any code', async () => {
    const files = normalizeFiles({
      'App.tsx': `import _ from 'lodash';\nexport default () => _.noop();`,
    });
    await expect(loadGraph(files, '/App.tsx', loaders)).rejects.toThrow(
      'The package "lodash" is not available offline',
    );
  });

  it('reports a missing local file with its importer', async () => {
    const files = normalizeFiles({ 'App.tsx': `import { X } from './nope';\nexport default X;` });
    await expect(loadGraph(files, '/App.tsx', loaders)).rejects.toThrow(
      'Cannot find "./nope", imported by /App.tsx.',
    );
  });
});

describe('start', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mount = (files: Record<string, string>) => {
    document.body.innerHTML = `<div id="root"></div><script type="application/json" id="${SANDBOX_FILES_ELEMENT_ID}">${JSON.stringify(files)}</script>`;
  };

  it('renders the default export of App.tsx into #root', async () => {
    mount({ 'App.tsx': counterApp, ...shadcnFiles });
    await start(loaders);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const button = document.querySelector('button');
    expect(button?.textContent).toContain('Add');
    expect(button?.querySelector('svg')).not.toBeNull();
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('[data-testid="count"]')?.textContent).toBe('3');
  });

  it('shows an error overlay instead of a blank page', async () => {
    mount({ 'App.tsx': `import x from 'left-pad';\nexport default x;` });
    await start(loaders);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'The package "left-pad" is not available offline',
    );
  });
});
