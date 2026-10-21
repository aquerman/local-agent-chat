/**
 * The site allow-list. Entries follow Playwright MCP's own `--allowed-origins` rules, so the
 * navigation pre-check here and the browser's network filter agree on what is allowed:
 * - `https://example.com` (full origin): that scheme, host and port only;
 * - `http://localhost:*` (wildcard port): that scheme and host on any port;
 * - `example.com` or `*.example.com` (host pattern): http and https on the default port,
 *   where `*` stands for any run of characters without a `/`.
 */
export type OriginRule =
  | { kind: 'origin'; origin: string }
  | { kind: 'anyPort'; protocol: string; hostname: string }
  | { kind: 'host'; pattern: RegExp };

const UNRESOLVED_PLACEHOLDER = /^\$\{[^}]*\}$/;
const WILDCARD_PORT = /^(https?):\/\/([^/:]+):\*$/;

/**
 * LibreChat leaves `${VAR}` in place when the variable is unset; such a value counts as empty, so
 * a missing `.env` key never turns into a literal entry.
 */
export function readEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '' || UNRESOLVED_PLACEHOLDER.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** Splits the `.env` value on `;`, `,` or whitespace and drops empty entries. */
export function parseOrigins(raw: string | undefined): string[] {
  const value = readEnvValue(raw);
  if (value === undefined) {
    return [];
  }
  return value.split(/[;,\s]+/).filter((entry) => entry !== '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export function toRule(entry: string): OriginRule {
  const anyPort = entry.match(WILDCARD_PORT);
  if (anyPort) {
    return { kind: 'anyPort', protocol: `${anyPort[1]}:`, hostname: anyPort[2].toLowerCase() };
  }
  try {
    const url = new URL(entry);
    if (url.origin !== 'null') {
      return { kind: 'origin', origin: url.origin };
    }
  } catch {
    /* not a URL: a host pattern */
  }
  const source = entry.toLowerCase().split('*').map(escapeRegExp).join('[^/]*');
  return { kind: 'host', pattern: new RegExp(`^${source}$`) };
}

function matches(rule: OriginRule, url: URL): boolean {
  switch (rule.kind) {
    case 'origin':
      return url.origin === rule.origin;
    case 'anyPort':
      return url.protocol === rule.protocol && url.hostname === rule.hostname;
    case 'host':
      return rule.pattern.test(url.host);
  }
}

/**
 * Whether the browser may open `target`. `about:` pages are always allowed (a new tab starts on
 * `about:blank`); other non-web schemes (`file:`, `data:`, `javascript:`, `chrome:`) never are.
 */
export function isAllowedUrl(target: string, rules: OriginRule[]): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol === 'about:') {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  return rules.some((rule) => matches(rule, url));
}
