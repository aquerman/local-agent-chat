import { isAllowedUrl, parseOrigins, readEnvValue, toRule } from '~/origins';

const rules = (...entries: string[]) => entries.map(toRule);

describe('parseOrigins', () => {
  it('splits on semicolons, commas and whitespace', () => {
    expect(parseOrigins(' https://a.com; b.org,  http://localhost:* ')).toEqual([
      'https://a.com',
      'b.org',
      'http://localhost:*',
    ]);
  });

  it('treats an unset LibreChat placeholder as empty', () => {
    expect(readEnvValue('${BROWSER_ALLOWED_ORIGINS}')).toBeUndefined();
    expect(parseOrigins('${BROWSER_ALLOWED_ORIGINS}')).toEqual([]);
    expect(parseOrigins(undefined)).toEqual([]);
  });
});

describe('isAllowedUrl', () => {
  it('matches a full origin exactly', () => {
    const allowed = rules('https://shop.example');
    expect(isAllowedUrl('https://shop.example/cart?x=1', allowed)).toBe(true);
    expect(isAllowedUrl('http://shop.example/', allowed)).toBe(false);
    expect(isAllowedUrl('https://shop.example:8443/', allowed)).toBe(false);
    expect(isAllowedUrl('https://evil.shop.example/', allowed)).toBe(false);
  });

  it('matches any port for a wildcard-port entry', () => {
    const allowed = rules('http://127.0.0.1:*');
    expect(isAllowedUrl('http://127.0.0.1:3187/', allowed)).toBe(true);
    expect(isAllowedUrl('https://127.0.0.1:3187/', allowed)).toBe(false);
  });

  it('matches a host pattern on http and https, with * for subdomains', () => {
    const allowed = rules('example.com', '*.github.com');
    expect(isAllowedUrl('https://example.com/a', allowed)).toBe(true);
    expect(isAllowedUrl('http://example.com/a', allowed)).toBe(true);
    expect(isAllowedUrl('https://www.example.com/', allowed)).toBe(false);
    expect(isAllowedUrl('https://api.github.com/', allowed)).toBe(true);
    expect(isAllowedUrl('https://github.com/', allowed)).toBe(false);
    expect(isAllowedUrl('https://github.com.evil.net/', allowed)).toBe(false);
  });

  it('always allows about: and never other schemes', () => {
    const allowed = rules('example.com');
    expect(isAllowedUrl('about:blank', [])).toBe(true);
    expect(isAllowedUrl('file:///etc/passwd', allowed)).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)', allowed)).toBe(false);
    expect(isAllowedUrl('not a url', allowed)).toBe(false);
  });

  it('allows nothing when the list is empty', () => {
    expect(isAllowedUrl('https://example.com/', [])).toBe(false);
  });
});
