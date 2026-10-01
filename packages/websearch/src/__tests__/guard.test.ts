import { assertPublicHttpUrl, WebSearchError } from '~/guard';

describe('assertPublicHttpUrl', () => {
  it('returns a URL for a public https address', () => {
    expect(assertPublicHttpUrl('https://example.com/a?b=1').href).toBe('https://example.com/a?b=1');
  });

  it('rejects unparseable input', () => {
    expect(() => assertPublicHttpUrl('not a url')).toThrow(
      new WebSearchError('Refused to fetch not a url: invalid URL'),
    );
  });

  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'rejects non-http scheme %s',
    (raw) => {
      expect(() => assertPublicHttpUrl(raw)).toThrow(/only http and https are allowed/);
    },
  );

  it.each([
    'http://localhost:3080/',
    'http://api.localhost/',
    'http://127.0.0.1:27017/',
    'http://127.5.5.5/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
  ])('rejects private or loopback host %s', (raw) => {
    expect(() => assertPublicHttpUrl(raw)).toThrow(
      /loopback, link-local and private hosts are blocked/,
    );
  });

  it.each(['http://172.32.0.1/', 'http://8.8.8.8/', 'http://[2606:4700::1111]/'])(
    'allows public literal %s',
    (raw) => {
      expect(() => assertPublicHttpUrl(raw)).not.toThrow();
    },
  );
});
