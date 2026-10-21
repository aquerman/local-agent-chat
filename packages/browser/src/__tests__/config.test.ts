import path from 'node:path';
import { NOTHING_ALLOWED, readSettings, toLaunchOptions, toPlaywrightConfig } from '~/config';

describe('readSettings', () => {
  it('defaults to a visible Microsoft Edge in data/browser-profile on Windows', () => {
    const settings = readSettings({}, 'win32', '/repo');
    expect(settings).toEqual({
      allowedOrigins: [],
      profileDir: path.resolve('/repo', 'data', 'browser-profile'),
      channel: 'msedge',
      headless: false,
      sandbox: true,
      maxChars: 12_000,
    });
  });

  it('defaults to headless Playwright Chromium elsewhere', () => {
    const settings = readSettings({}, 'linux', '/repo');
    expect(settings.channel).toBeUndefined();
    expect(settings.headless).toBe(true);
  });

  it('reads overrides and ignores unresolved placeholders', () => {
    const settings = readSettings(
      {
        BROWSER_ALLOWED_ORIGINS: 'example.com;https://shop.example',
        BROWSER_EXECUTABLE_PATH: '/opt/chrome',
        BROWSER_CHANNEL: '${BROWSER_CHANNEL}',
        BROWSER_HEADLESS: 'true',
        BROWSER_NO_SANDBOX: 'true',
        BROWSER_MAX_CHARS: '5000',
        BROWSER_PROFILE_DIR: '${BROWSER_PROFILE_DIR}',
      },
      'win32',
      '/repo',
    );
    expect(settings).toMatchObject({
      allowedOrigins: ['example.com', 'https://shop.example'],
      executablePath: '/opt/chrome',
      headless: true,
      sandbox: false,
      maxChars: 5000,
      profileDir: path.resolve('/repo', 'data', 'browser-profile'),
    });
    expect(settings.channel).toBeUndefined();
  });

  it('falls back on a bad number', () => {
    expect(readSettings({ BROWSER_MAX_CHARS: 'lots' }, 'linux').maxChars).toBe(12_000);
  });
});

describe('toPlaywrightConfig', () => {
  it('turns snapshots in action results, images, codegen and WebMCP off', () => {
    const config = toPlaywrightConfig(readSettings({ BROWSER_ALLOWED_ORIGINS: 'a.com' }, 'win32'));
    expect(config.snapshot).toEqual({ mode: 'none' });
    expect(config.imageResponses).toBe('omit');
    expect(config.codegen).toBe('none');
    expect(config.webmcp).toBe(false);
    expect(config.network?.allowedOrigins).toEqual(['a.com']);
    expect(config.browser?.isolated).toBe(false);
  });

  it('opens Edge with the sandbox and without service workers', () => {
    expect(toLaunchOptions(readSettings({}, 'win32'))).toMatchObject({
      channel: 'msedge',
      headless: false,
      chromiumSandbox: true,
      serviceWorkers: 'block',
    });
  });

  it('allows no network origin at all when the list is empty', () => {
    const config = toPlaywrightConfig(readSettings({}, 'linux'));
    expect(config.network?.allowedOrigins).toEqual([NOTHING_ALLOWED]);
  });
});
