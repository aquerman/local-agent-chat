import { DEFAULT_LIMITS, parseSources, readConfig } from '~/limits';

describe('readConfig', () => {
  it('treats an unfilled LibreChat placeholder as no calendar', () => {
    expect(parseSources('{{CALENDAR_ICS_URL}}')).toEqual([]);
    expect(parseSources('${CALENDAR_ICS_URL}')).toEqual([]);
    expect(parseSources('')).toEqual([]);
  });

  it('splits several feeds on | and keeps paths with spaces whole', () => {
    expect(parseSources(' https://a.example/x.ics | C:\\My Calendars\\work.ics ')).toEqual([
      'https://a.example/x.ics',
      'C:\\My Calendars\\work.ics',
    ]);
  });

  it('reads limits and falls back on invalid values', () => {
    const config = readConfig({
      CALENDAR_ICS_URL: 'https://a.example/x.ics',
      CALENDAR_TIMEZONE: 'Not/AZone',
      CALENDAR_CACHE_SECONDS: '0',
      CALENDAR_TIMEOUT_MS: '-5',
    });
    expect(config.sources).toEqual(['https://a.example/x.ics']);
    expect(config.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(config.limits.cacheMs).toBe(0);
    expect(config.limits.timeoutMs).toBe(DEFAULT_LIMITS.timeoutMs);
    expect(readConfig({ CALENDAR_TIMEZONE: 'Asia/Tokyo' }).timeZone).toBe('Asia/Tokyo');
  });
});
