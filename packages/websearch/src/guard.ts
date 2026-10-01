import { isIPv4, isIPv6 } from 'node:net';

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSearchError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) {
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

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') {
    return true;
  }
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    return isPrivateIPv4(dotted[1]);
  }
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return isPrivateIPv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (isIPv4(host)) {
    return isPrivateIPv4(host);
  }
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIPv6(bare)) {
    return isPrivateIPv6(bare);
  }
  return false;
}

function refuse(raw: string, reason: string): never {
  throw new WebSearchError(`Refused to fetch ${raw}: ${reason}`);
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse(raw, 'invalid URL');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return refuse(raw, 'only http and https are allowed');
  }
  if (isPrivateHost(url.hostname)) {
    return refuse(raw, 'loopback, link-local and private hosts are blocked');
  }
  return url;
}
