import { isIPv4, isIPv6 } from 'node:net';

/** True for any address a fetch must never reach: loopback, link-local, unique-local, private. */
export function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) {
    return isPrivateIPv4(address);
  }
  return isIPv6(address) && isPrivateIPv6(address);
}

/** Strips the brackets of a URL hostname and returns it if it is an IP literal. */
export function literalAddress(hostname: string): string | undefined {
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return isIPv4(bare) || isIPv6(bare) ? bare : undefined;
}

type IPv4Range = { first: number; second?: [number, number] };

/** Blocked IPv4 ranges by first octet, optionally narrowed by a second-octet span. */
const PRIVATE_IPV4_RANGES: IPv4Range[] = [
  { first: 0 },
  { first: 10 },
  { first: 127 },
  { first: 100, second: [64, 127] },
  { first: 169, second: [254, 254] },
  { first: 172, second: [16, 31] },
  { first: 192, second: [168, 168] },
];

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return PRIVATE_IPV4_RANGES.some(
    ({ first, second }) => a === first && (!second || (b >= second[0] && b <= second[1])),
  );
}

const IPV6_LOOPBACK = new Set(['::1', '::']);
const IPV6_MAPPED_DOTTED = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/;
const IPV6_MAPPED_HEX = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;
const IPV6_LINK_LOCAL_MASK = 0xffc0;
const IPV6_LINK_LOCAL_PREFIX = 0xfe80;
const IPV6_UNIQUE_LOCAL_PREFIXES = ['fc', 'fd'];

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (IPV6_LOOPBACK.has(lower)) {
    return true;
  }
  const mapped = mappedIPv4(lower);
  if (mapped !== undefined) {
    return isPrivateIPv4(mapped);
  }
  return isLinkLocalIPv6(lower) || isUniqueLocalIPv6(lower);
}

/** Returns the IPv4 address embedded in an IPv4-mapped or IPv4-compatible IPv6 address. */
function mappedIPv4(lower: string): string | undefined {
  const dotted = lower.match(IPV6_MAPPED_DOTTED);
  if (dotted) {
    return dotted[1];
  }
  const hex = lower.match(IPV6_MAPPED_HEX);
  if (!hex) {
    return undefined;
  }
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isLinkLocalIPv6(lower: string): boolean {
  const firstHextet = parseInt(lower.split(':')[0] || '0', 16);
  return (firstHextet & IPV6_LINK_LOCAL_MASK) === IPV6_LINK_LOCAL_PREFIX;
}

function isUniqueLocalIPv6(lower: string): boolean {
  return IPV6_UNIQUE_LOCAL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
