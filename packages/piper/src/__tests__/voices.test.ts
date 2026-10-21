import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listVoices, pickVoice, toVoice } from '~/voices';

const voices = ['en_US-lessac-medium', 'nl_NL-mls-medium'].map(toVoice);

describe('listVoices', () => {
  it('lists .onnx files that have a config next to them', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'piper-voices-'));
    await Promise.all(
      [
        'nl_NL-mls-medium.onnx',
        'nl_NL-mls-medium.onnx.json',
        'en_US-lessac-medium.onnx',
        'notes.txt',
      ].map((name) => fs.writeFile(path.join(dir, name), '')),
    );
    await expect(listVoices(dir)).resolves.toEqual([{ id: 'nl_NL-mls-medium', language: 'nl' }]);
    await fs.rm(dir, { recursive: true });
  });

  it('returns nothing for a missing folder', async () => {
    await expect(listVoices(path.join(os.tmpdir(), 'does-not-exist-piper'))).resolves.toEqual([]);
  });
});

describe('pickVoice', () => {
  it('uses an installed voice asked for by name', () => {
    expect(pickVoice(voices, 'en_US-lessac-medium', 'nl', 'nl_NL-mls-medium')).toBe(
      'en_US-lessac-medium',
    );
  });

  it('picks by detected language for auto or unknown names', () => {
    expect(pickVoice(voices, 'auto', 'nl', 'en_US-lessac-medium')).toBe('nl_NL-mls-medium');
    expect(pickVoice(voices, 'alloy', 'en', 'nl_NL-mls-medium')).toBe('en_US-lessac-medium');
  });

  it('falls back to the default voice, then the first one', () => {
    expect(pickVoice(voices, 'auto', null, 'nl_NL-mls-medium')).toBe('nl_NL-mls-medium');
    expect(pickVoice(voices, 'auto', 'fr', 'missing')).toBe('en_US-lessac-medium');
    expect(pickVoice([], 'auto', 'en', 'x')).toBeUndefined();
  });
});
