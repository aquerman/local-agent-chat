import { assertPublicHttpUrl } from '~/guard';
import { WebSearchError } from '~/errors';
import type { Resolver } from '~/guard';

const publicResolver: Resolver = async () => ['93.184.216.34'];
const loopbackResolver: Resolver = async () => ['127.0.0.1'];
const mixedResolver: Resolver = async () => ['93.184.216.34', '10.0.0.5'];
const failingResolver: Resolver = async () => {
  throw new Error('ENOTFOUND');
};

describe('assertPublicHttpUrl', () => {
  it('returns a URL for a public https address', async () => {
    const url = await assertPublicHttpUrl('https://example.com/a?b=1', publicResolver);
    expect(url.href).toBe('https://example.com/a?b=1');
  });

  it('rejects unparseable input', async () => {
    await expect(assertPublicHttpUrl('not a url', publicResolver)).rejects.toThrow(
      new WebSearchError('Refused to fetch not a url: invalid URL'),
    );
  });

  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'rejects non-http scheme %s',
    async (raw) => {
      await expect(assertPublicHttpUrl(raw, publicResolver)).rejects.toThrow(
        /only http and https are allowed/,
      );
    },
  );

  it.each([
    'http://localhost:3080/',
    'http://localhost.:3080/',
    'http://api.localhost/',
    'http://127.0.0.1:27017/',
    'http://127.5.5.5/',
    'http://10.0.0.1/',
    'http://100.64.0.1/',
    'http://100.127.255.254/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fe90::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::7f00:1]/',
  ])('rejects private or loopback host %s', async (raw) => {
    await expect(assertPublicHttpUrl(raw, publicResolver)).rejects.toThrow(
      /loopback, link-local and private hosts are blocked/,
    );
  });

  it.each([
    'http://172.32.0.1/',
    'http://100.128.0.1/',
    'http://8.8.8.8/',
    'http://[2606:4700::1111]/',
    'http://[fec0::1]/',
  ])('allows public literal %s', async (raw) => {
    await expect(assertPublicHttpUrl(raw, publicResolver)).resolves.toBeInstanceOf(URL);
  });

  it('refuses a name that resolves to a loopback address', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1.nip.io/', loopbackResolver)).rejects.toThrow(
      'Refused to fetch http://127.0.0.1.nip.io/: loopback, link-local and private hosts are blocked',
    );
  });

  it('refuses a name when any resolved address is private', async () => {
    await expect(assertPublicHttpUrl('http://dual.example/', mixedResolver)).rejects.toThrow(
      /loopback, link-local and private hosts are blocked/,
    );
  });

  it('refuses a name that does not resolve', async () => {
    await expect(assertPublicHttpUrl('http://nope.invalid/', failingResolver)).rejects.toThrow(
      'Refused to fetch http://nope.invalid/: host could not be resolved',
    );
  });

  it('does not resolve IP literals', async () => {
    const resolver = jest.fn(publicResolver);
    await assertPublicHttpUrl('http://8.8.8.8/', resolver);
    expect(resolver).not.toHaveBeenCalled();
  });
});
