import { lookup } from 'node:dns/promises';
import { isPrivateAddress, literalAddress } from '~/addresses';
import { WebSearchError } from '~/errors';

/** Resolves a hostname to every address it maps to; injected so tests never touch DNS. */
export type Resolver = (hostname: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const PRIVATE_HOST = 'loopback, link-local and private hosts are blocked';

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
  try {
    const url = parseHttpUrl(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (isLocalhostName(host)) {
      throw new Error(PRIVATE_HOST);
    }
    const addresses = await hostAddresses(host, resolve);
    if (addresses.some(isPrivateAddress)) {
      throw new Error(PRIVATE_HOST);
    }
    return url;
  } catch (error) {
    throw new WebSearchError(`Refused to fetch ${raw}: ${(error as Error).message}`);
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error('only http and https are allowed');
  }
  return url;
}

function isLocalhostName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

/** An IP literal is its own address; a name is resolved, and a lookup failure is a refusal. */
async function hostAddresses(host: string, resolve: Resolver): Promise<string[]> {
  const literal = literalAddress(host);
  if (literal !== undefined) {
    return [literal];
  }
  try {
    return await resolve(host);
  } catch {
    throw new Error('host could not be resolved');
  }
}
