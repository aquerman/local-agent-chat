import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FetchFn } from '~/fetch';
import type { Resolver } from '~/guard';
import { isPrivateAddress } from '~/addresses';

/** `public.test` is the test server on 127.0.0.1; `internal.test` stands for a LAN host. */
const HOSTS: Record<string, string[]> = {
  'public.test': ['127.0.0.1'],
  'internal.test': ['127.0.0.2'],
};

export const resolve: Resolver = async (host) => {
  const addresses = HOSTS[host];
  if (addresses === undefined) {
    throw new Error('ENOTFOUND');
  }
  return addresses;
};

/** Only the test server's own address is let through; every other private address stays blocked. */
export const isBlocked = (address: string): boolean =>
  address !== '127.0.0.1' && isPrivateAddress(address);

/** Static fetch for `public.test` URLs, which Node's DNS cannot resolve. */
export const fetchViaLoopback: FetchFn = (input, init) =>
  globalThis.fetch(String(input).replace('//public.test:', '//127.0.0.1:'), init);

export const LONG_TEXT = 'Rendered by JavaScript after load. '.repeat(12).trim();

function jsPage(script: string): string {
  return `<!doctype html><html><head><title>JS app</title></head><body><div id="app"></div>
<script>${script}</script></body></html>`;
}

const PAGES: Record<string, (port: number) => string> = {
  '/js': () =>
    jsPage(`fetch('/data').then(r => r.json()).then(d => {
      document.getElementById('app').innerHTML = '<main><h1>' + d.title + '</h1><p>' + d.text + '</p></main>';
    });`),
  '/leaky': (port) =>
    jsPage(`fetch('http://internal.test:${port}/secret').catch(() => {});
      fetch('http://127.0.0.2:${port}/secret').catch(() => {});
      const frame = document.createElement('iframe');
      frame.src = 'http://internal.test:${port}/secret';
      document.body.appendChild(frame);
      document.getElementById('app').innerHTML = '<p>' + ${JSON.stringify(LONG_TEXT)} + '</p>';`),
  '/heavy': () =>
    jsPage(`fetch('/big').then(r => r.text()).then(t => {
      document.getElementById('app').textContent = t;
    });`),
  '/static': () =>
    `<html><head><title>Static</title></head><body><main><p>${LONG_TEXT}</p></main></body></html>`,
};

export interface TestSite {
  origin: string;
  port: number;
  hits: string[];
  close(): Promise<void>;
}

export async function startSite(): Promise<TestSite> {
  const hits: string[] = [];
  let port = 0;
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(`${req.headers.host}${path}`);
    if (path === '/data') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ title: 'Loaded heading', text: LONG_TEXT }));
      return;
    }
    if (path === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('y'.repeat(50_000));
      return;
    }
    if (path === '/to-internal') {
      res.writeHead(302, { location: `http://internal.test:${port}/secret` });
      res.end();
      return;
    }
    if (path === '/hang') {
      return;
    }
    const page = PAGES[path];
    if (page === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page(port));
  });
  await new Promise<void>((done) => server.listen(0, '0.0.0.0', done));
  port = (server.address() as AddressInfo).port;
  return {
    origin: `http://public.test:${port}`,
    port,
    hits,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
