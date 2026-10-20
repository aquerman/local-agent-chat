import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { AddressFilter, Resolver } from '~/guard';
import { publicAddresses } from '~/guard';

export interface ProxyOptions {
  resolve: Resolver;
  isBlocked: AddressFilter;
  /** Total bytes the proxy accepts from upstream servers before it cuts every connection. */
  maxBytes: number;
}

/**
 * A forward proxy the headless browser is pointed at, so every request it makes (the page, each
 * redirect hop, subresources, iframes, fetch/XHR, WebSockets) passes the same public-host rule as
 * the static fetch. The proxy dials the address it checked, not the hostname, so a host cannot
 * swap its DNS answer between the check and the connection.
 */
export interface GuardedProxy {
  /** `http://127.0.0.1:<port>`, for the browser context's `proxy.server`. */
  readonly server: string;
  /** Hosts the proxy refused, in order. */
  readonly refused: readonly string[];
  /** True once upstream bytes passed `maxBytes`. */
  readonly exceeded: boolean;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

function endToEndHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())),
  );
}

function refuse(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
}

export async function startGuardedProxy(options: ProxyOptions): Promise<GuardedProxy> {
  const { resolve, isBlocked, maxBytes } = options;
  const refused: string[] = [];
  const sockets = new Set<Duplex>();
  let received = 0;
  let exceeded = false;

  const track = (socket: Duplex): void => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };

  const destroyAll = (): void => {
    for (const socket of sockets) {
      socket.destroy();
    }
  };

  const count = (bytes: number): void => {
    received += bytes;
    if (received > maxBytes && !exceeded) {
      exceeded = true;
      destroyAll();
    }
  };

  /** Resolves and checks the host; on refusal records it and returns undefined. */
  const dialAddress = async (hostname: string): Promise<string | undefined> => {
    if (exceeded) {
      return undefined;
    }
    try {
      const [address] = await publicAddresses(hostname, resolve, isBlocked);
      return address;
    } catch {
      refused.push(hostname);
      return undefined;
    }
  };

  const server = http.createServer(async (req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    const address = await dialAddress(target.hostname);
    if (address === undefined) {
      res.writeHead(403, { connection: 'close' }).end();
      return;
    }
    const upstream = http.request(
      {
        host: address,
        port: Number(target.port) || DEFAULT_PORTS[target.protocol],
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...endToEndHeaders(req.headers), host: target.host },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, endToEndHeaders(upstreamRes.headers));
        upstreamRes.on('data', (chunk: Buffer) => count(chunk.byteLength));
        upstreamRes.pipe(res);
      },
    );
    upstream.on('socket', track);
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { connection: 'close' });
      }
      res.end();
    });
    req.pipe(upstream);
  });

  server.on('connection', track);

  server.on('connect', async (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    let target: URL;
    try {
      target = new URL(`https://${req.url ?? ''}`);
    } catch {
      refuse(client, '400 Bad Request');
      return;
    }
    const address = await dialAddress(target.hostname);
    if (address === undefined) {
      refuse(client, '403 Forbidden');
      return;
    }
    const upstream = net.connect(Number(target.port) || DEFAULT_PORTS['https:'], address);
    track(upstream);
    upstream.on('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.on('data', (chunk: Buffer) => count(chunk.byteLength));
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => refuse(client, '502 Bad Gateway'));
    client.on('error', () => upstream.destroy());
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as AddressInfo;

  return {
    server: `http://127.0.0.1:${port}`,
    refused,
    get exceeded() {
      return exceeded;
    },
    close: () =>
      new Promise<void>((resolveClose) => {
        destroyAll();
        server.close(() => resolveClose());
      }),
  };
}
