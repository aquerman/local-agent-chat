import { DEFAULT_LIMITS, readLimits } from '~/limits';

describe('readLimits', () => {
  it('returns the defaults when no env is set', () => {
    expect(readLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it('applies WEBSEARCH_MAX_CHARS and WEBSEARCH_TIMEOUT_MS', () => {
    const limits = readLimits({ WEBSEARCH_MAX_CHARS: '4000', WEBSEARCH_TIMEOUT_MS: '2500' });
    expect(limits.maxChars).toBe(4000);
    expect(limits.timeoutMs).toBe(2500);
  });

  it('ignores values that are not positive integers', () => {
    const limits = readLimits({ WEBSEARCH_MAX_CHARS: 'lots', WEBSEARCH_TIMEOUT_MS: '-1' });
    expect(limits.maxChars).toBe(DEFAULT_LIMITS.maxChars);
    expect(limits.timeoutMs).toBe(DEFAULT_LIMITS.timeoutMs);
  });

  it('defaults the byte cap to 5 MB and applies WEBSEARCH_MAX_BYTES', () => {
    expect(readLimits({}).maxBytes).toBe(5_000_000);
    expect(readLimits({ WEBSEARCH_MAX_BYTES: '10000000' }).maxBytes).toBe(10_000_000);
    expect(readLimits({ WEBSEARCH_MAX_BYTES: 'big' }).maxBytes).toBe(5_000_000);
  });

  it('clamps WEBSEARCH_MAX_CHARS to the hard cap', () => {
    expect(readLimits({ WEBSEARCH_MAX_CHARS: '99999' }).maxChars).toBe(DEFAULT_LIMITS.maxCharsCap);
  });
});
