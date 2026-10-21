import path from 'node:path';
import { readConfig } from '~/config';

describe('readConfig', () => {
  it('defaults to the venv and voices under bin/piper', () => {
    const config = readConfig({}, '/repo', 'win32');
    expect(config.port).toBe(8083);
    expect(config.piperPort).toBe(8084);
    expect(config.python).toBe(path.join('/repo', 'bin', 'piper', 'Scripts', 'python.exe'));
    expect(config.voicesDir).toBe(path.resolve('/repo', 'bin', 'piper', 'voices'));
    expect(config.ffmpeg).toBe('ffmpeg');
  });

  it('reads overrides and rejects a bad port', () => {
    const config = readConfig(
      { VOICE_TTS_PORT: '9000', PIPER_URL: 'http://127.0.0.1:5000' },
      '/repo',
      'linux',
    );
    expect(config.port).toBe(9000);
    expect(config.piperUrl).toBe('http://127.0.0.1:5000');
    expect(() => readConfig({ VOICE_TTS_PORT: 'abc' }, '/repo', 'linux')).toThrow('VOICE_TTS_PORT');
  });
});
