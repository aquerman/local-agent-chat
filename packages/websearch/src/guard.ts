import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSearchError';
  }
}

/** Resolves a hostname to every address it maps to; injected so tests never touch DNS. */
export type Resolver = (hostname: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const LINK_LOCAL_V6_MASK = 0xffc0;
const LINK_LOCAL_V6_PREFIX = 0xfe80;

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  return a === 192 && b === 168;
}

function embeddedIPv4(high: string, low: string): string {
  const hi = parseInt(high, 16);
  const lo = parseInt(low, 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') {
    return true;
  }
  const dotted = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    return isPrivateIPv4(dotted[1]);
  }
  const hex = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    return isPrivateIPv4(embeddedIPv4(hex[1], hex[2]));
  }
  const firstHextet = parseInt(lower.split(':')[0] || '0', 16);
  if ((firstHextet & LINK_LOCAL_V6_MASK) === LINK_LOCAL_V6_PREFIX) {
    return true;
  }
  return lower.startsWith('fc') || lower.startsWith('fd');
}

function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) {
    return isPrivateIPv4(address);
  }
  return isIPv6(address) && isPrivateIPv6(address);
}

function literalAddress(hostname: string): string | undefined {
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return isIPv4(bare) || isIPv6(bare) ? bare : undefined;
}

function refuse(raw: string, reason: string): never {
  throw new WebSearchError(`Refused to fetch ${raw}: ${reason}`);
}

async function resolvedAddresses(raw: string, host: string, resolve: Resolver): Promise<string[]> {
  try {
    return await resolve(host);
  } catch {
    return refuse(raw, 'host could not be resolved');
  }
}

/**
 * Parses `raw` and refuses anything the model must not reach: non-http(s) schemes, `localhost`
 * names, and any literal or resolved address that is loopback, link-local or private. The check
 * is resolve-time, not connect-time, so a host that changes its answer between this lookup and the
 * connection (DNS rebinding) is not covered.
 */
export async function assertPublicHttpUrl(
  raw: string,
  resolve: Resolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse(raw, 'invalid URL');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return refuse(raw, 'only http and https are allowed');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return refuse(raw, 'loopback, link-local and private hosts are blocked');
  }
  const literal = literalAddress(host);
  const addresses = literal === undefined ? await resolvedAddresses(raw, host, resolve) : [literal];
  if (addresses.some(isPrivateAddress)) {
    return refuse(raw, 'loopback, link-local and private hosts are blocked');
  }
  return url;
}
