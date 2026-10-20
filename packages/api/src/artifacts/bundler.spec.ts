import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import type { Express } from 'express';
import { createStaticBundlerMiddleware, getPreviewHostPattern } from './bundler';

const PREVIEW_HOST = '18f0a2b3c4d-preview.localhost:3080';

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-bundler-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<p>relay fallback</p>');
  fs.mkdirSync(path.join(root, '__csb_relay'));
  fs.writeFileSync(path.join(root, '__csb_relay', 'index.html'), '<p>relay</p>');
  fs.writeFileSync(path.join(root, '__csb_sw.abc.js'), 'self.addEventListener("fetch",()=>{});');
  fs.mkdirSync(path.join(root, '__csb_vendor'));
  fs.writeFileSync(path.join(root, '__csb_vendor', 'tailwind.js'), '/* tailwind */');
  return root;
}

function appWith(bundlerURL: string | undefined, root: string): Express {
  const app = express();
  const middleware = createStaticBundlerMiddleware({ bundlerURL, root });
  if (middleware) {
    app.use(middleware);
  }
  app.use((_req, res) => {
    res.status(200).send('app');
  });
  return app;
}

describe('getPreviewHostPattern', () => {
  it('matches only `<hex id>-<bundler host>`', () => {
    const pattern = getPreviewHostPattern('http://preview.localhost:3080');
    expect(pattern?.test('18f0a2b3c4d-preview.localhost')).toBe(true);
    expect(pattern?.test('preview.localhost')).toBe(false);
    expect(pattern?.test('localhost')).toBe(false);
    expect(pattern?.test('evil-preview.localhost.example.com')).toBe(false);
    expect(pattern?.test('zz-preview.localhost')).toBe(false);
  });

  it('is off for unset, invalid and non-localhost URLs', () => {
    expect(getPreviewHostPattern(undefined)).toBeNull();
    expect(getPreviewHostPattern('')).toBeNull();
    expect(getPreviewHostPattern('not a url')).toBeNull();
    expect(
      getPreviewHostPattern('https://preview.sandpack-static-server.codesandbox.io'),
    ).toBeNull();
  });
});

describe('createStaticBundlerMiddleware', () => {
  const root = makeRoot();

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the bundler is not served locally', () => {
    expect(createStaticBundlerMiddleware({ bundlerURL: undefined, root })).toBeNull();
    expect(
      createStaticBundlerMiddleware({ bundlerURL: 'https://bundler.example.com', root }),
    ).toBeNull();
  });

  it('serves the relay, the service worker and the vendored Tailwind on preview hosts', async () => {
    const app = appWith('http://preview.localhost:3080', root);

    const relay = await request(app).get('/__csb_relay/').set('Host', PREVIEW_HOST);
    expect(relay.status).toBe(200);
    expect(relay.text).toBe('<p>relay</p>');

    const worker = await request(app).get('/__csb_sw.abc.js').set('Host', PREVIEW_HOST);
    expect(worker.status).toBe(200);
    expect(worker.headers['content-type']).toMatch(/javascript/);

    const tailwind = await request(app).get('/__csb_vendor/tailwind.js').set('Host', PREVIEW_HOST);
    expect(tailwind.status).toBe(200);
    expect(tailwind.text).toBe('/* tailwind */');
  });

  it('falls back to the relay index for unknown paths on preview hosts', async () => {
    const app = appWith('http://preview.localhost:3080', root);
    const response = await request(app).get('/some/page').set('Host', PREVIEW_HOST);
    expect(response.status).toBe(200);
    expect(response.text).toBe('<p>relay fallback</p>');
  });

  it('leaves the app host and other hosts to the app', async () => {
    const app = appWith('http://preview.localhost:3080', root);
    for (const host of ['localhost:3080', 'preview.localhost:3080', 'chat.example.com']) {
      const response = await request(app).get('/__csb_relay/').set('Host', host);
      expect(response.text).toBe('app');
    }
  });

  it('refuses writes on preview hosts', async () => {
    const app = appWith('http://preview.localhost:3080', root);
    const response = await request(app).post('/__csb_relay/').set('Host', PREVIEW_HOST);
    expect(response.status).toBe(405);
  });
});
