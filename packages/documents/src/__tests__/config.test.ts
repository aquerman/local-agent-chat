import os from 'node:os';
import path from 'node:path';
import { readBrowser, readConfig, DEFAULT_MAX_BYTES } from '~/config';

describe('readConfig', () => {
  it('defaults to A4, a temp folder and the platform browser', () => {
    const config = readConfig({}, 'linux');
    expect(config).toEqual({
      outputDir: path.join(os.tmpdir(), 'bennychat-documents'),
      pageSize: 'A4',
      browser: {},
      maxBytes: DEFAULT_MAX_BYTES,
      maxParts: 200,
    });
  });

  it('reads overrides and ignores invalid numbers', () => {
    const config = readConfig(
      {
        DOCUMENTS_DIR: '/data/docs',
        DOCUMENTS_PAGE_SIZE: 'letter',
        DOCUMENTS_MAX_BYTES: 'x',
        DOCUMENTS_MAX_SECTIONS: '5',
      },
      'linux',
    );
    expect(config).toMatchObject({
      outputDir: '/data/docs',
      pageSize: 'Letter',
      maxBytes: DEFAULT_MAX_BYTES,
      maxParts: 5,
    });
  });
});

describe('readBrowser', () => {
  it('uses Edge on Windows unless a path or channel is set', () => {
    expect(readBrowser({}, 'win32')).toEqual({ channel: 'msedge' });
    expect(readBrowser({ DOCUMENTS_BROWSER_CHANNEL: 'chrome' }, 'win32')).toEqual({
      channel: 'chrome',
    });
    expect(
      readBrowser(
        { DOCUMENTS_BROWSER_PATH: ' C:/chrome.exe ', DOCUMENTS_BROWSER_CHANNEL: 'chrome' },
        'win32',
      ),
    ).toEqual({
      executablePath: 'C:/chrome.exe',
    });
  });
});
