import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { GuardedProxy } from '~/proxy';
import type { Resolver } from '~/guard';
import { isPrivateAddress } from '~/addresses';
import { startGuardedProxy } from '~/proxy';

const hosts: Record<string, string[]> = {
  'public.test': ['127.0.0.1'],
  'internal.test': ['127.0.0.2'],
};
const resolve: Resolver = async (host) => hosts[host] ?? Promise.reject(new Error('ENOTFOUND'));
const isBlocked = (address: string): boolean =>
  address !== '127.0.0.1' && isPrivateAddress(address);

let origin: http.Server;
let port: number;
const hits: string[] = [];

beforeAll(async () => {
  origin = http.createServer((req, res) => {
    hits.push(`${req.headers.host}${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(req.url === '/big' ? 'x'.repeat(10_000) : 'hello');
  });
  await new Promise<void>((done) => origin.listen(0, '0.0.0.0', done));
  port = (origin.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((done) => origin.close(() => done()));
});

let proxy: GuardedProxy;
beforeEach(async () => {
  hits.length = 0;
  proxy = await startGuardedProxy({ resolve, isBlocked, maxBytes: 5000 });
});
afterEach(() => proxy.close());

function viaProxy(target: string): Promise<{ status: number; body: string }> {
  const { port: proxyPort } = new URL(proxy.server);
  return new Promise((done, fail) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(proxyPort),
        path: target,
        headers: { host: new URL(target).host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
        res.on('error', fail);
      },
    );
    req.on('error', fail);
    req.end();
  });
}

function connectVia(target: string): Promise<string> {
  const { port: proxyPort } = new URL(proxy.server);
  return new Promise((done, fail) => {
    const socket = net.connect(Number(proxyPort), '127.0.0.1', () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nhost: ${target}\r\n\r\n`);
    });
    socket.once('data', (chunk: Buffer) => {
      done(chunk.toString().split('\r\n')[0]);
      socket.destroy();
    });
    socket.on('error', fail);
  });
}

describe('startGuardedProxy', () => {
  it('forwards plain http to an allowed host, dialing the resolved address', async () => {
    const result = await viaProxy(`http://public.test:${port}/page?a=1`);
    expect(result).toEqual({ status: 200, body: 'hello' });
    expect(hits).toEqual([`public.test:${port}/page?a=1`]);
    expect(proxy.refused).toEqual([]);
  });

  it.each([
    ['a host resolving to a blocked address', 'internal.test'],
    ['a blocked literal', '127.0.0.2'],
    ['a localhost name', 'localhost'],
    ['an unresolvable host', 'nowhere.test'],
  ])('refuses %s with 403 and never reaches it', async (_label, host) => {
    const result = await viaProxy(`http://${host}:${port}/secret`);
    expect(result.status).toBe(403);
    expect(hits).toEqual([]);
    expect(proxy.refused).toEqual([host]);
  });

  it('tunnels CONNECT to an allowed host and refuses a blocked one', async () => {
    await expect(connectVia(`public.test:${port}`)).resolves.toBe(
      'HTTP/1.1 200 Connection Established',
    );
    await expect(connectVia(`internal.test:${port}`)).resolves.toBe('HTTP/1.1 403 Forbidden');
    expect(proxy.refused).toEqual(['internal.test']);
  });

  it('cuts connections once upstream bytes pass the cap', async () => {
    await viaProxy(`http://public.test:${port}/big`).catch(() => undefined);
    expect(proxy.exceeded).toBe(true);
    const after = await viaProxy(`http://public.test:${port}/page`);
    expect(after.status).toBe(403);
  });
});
