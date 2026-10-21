import {
  SANDBOX_MODULES,
  SANDBOX_RUNTIME_PATH,
  SANDBOX_FILES_ELEMENT_ID,
  SANDBOX_SKIPPED_DEPENDENCIES,
} from '../modules';
import { getOfflineReactFiles, isOfflineReactPreview } from '../preview';
import { getDependencies, sharedFiles } from '~/utils/artifacts';

const embeddedFiles = (html: string): Record<string, string> => {
  const match = html.match(
    new RegExp(
      `<script type="application/json" id="${SANDBOX_FILES_ELEMENT_ID}">(.*?)</script>`,
      's',
    ),
  );
  return JSON.parse(match?.[1] ?? 'null');
};

describe('isOfflineReactPreview', () => {
  it('applies only to React artifacts on a self-hosted bundler', () => {
    expect(isOfflineReactPreview('react-ts', 'App.tsx', true)).toBe(true);
    expect(isOfflineReactPreview('react-ts', 'App.tsx', false)).toBe(false);
    expect(isOfflineReactPreview('react-ts', 'diagram.mmd', true)).toBe(false);
    expect(isOfflineReactPreview('static', 'index.html', true)).toBe(false);
  });
});

describe('getOfflineReactFiles', () => {
  it('builds one static page from the react-ts template, sources and runtime', () => {
    const files = getOfflineReactFiles({
      ...sharedFiles,
      'App.tsx': { code: 'export default () => <p>{"</script>"}</p>;' },
    });
    const html = files['/index.html'] as string;
    expect(Object.keys(files)).toEqual(['/index.html']);
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain(`<script type="module" src="${SANDBOX_RUNTIME_PATH}"></script>`);
    expect(html).not.toContain('{"</script>"}');

    const sources = embeddedFiles(html);
    expect(sources['App.tsx']).toBe('export default () => <p>{"</script>"}</p>;');
    expect(sources['/components/ui/button.tsx']).toBe(sharedFiles['/components/ui/button.tsx']);
    expect(sources['/public/index.html']).toBeUndefined();
  });
});

describe('SANDBOX_MODULES', () => {
  it('vendors every package the online react-ts template installs', () => {
    const vendored = new Set<string>([...SANDBOX_MODULES, ...SANDBOX_SKIPPED_DEPENDENCIES]);
    const missing = Object.keys(getDependencies('application/vnd.react')).filter(
      (name) => !vendored.has(name),
    );
    expect(missing).toEqual([]);
  });
});
