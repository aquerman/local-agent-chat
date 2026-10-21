import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandFolder, defaultFolder, resolveFolders } from './folders.mjs';

const home = path.join(path.sep, 'home', 'user');

test('uses the default folder when BENNY_FOLDERS is unset, empty or a raw placeholder', () => {
  for (const value of [undefined, '', '   ', '${BENNY_FOLDERS}']) {
    assert.deepEqual(resolveFolders({ BENNY_FOLDERS: value }, { home }), {
      folders: [defaultFolder(home)],
      isDefault: true,
    });
  }
});

test('splits on the given delimiter, trims, unquotes and drops empty and duplicate entries', () => {
  const env = { BENNY_FOLDERS: ' "C:\\Notes" ;;D:\\Work; C:\\Notes ' };
  assert.deepEqual(resolveFolders(env, { home, delimiter: ';' }), {
    folders: ['C:\\Notes', 'D:\\Work'],
    isDefault: false,
  });
});

test('expands Windows %VAR%, ${VAR} and a leading ~', () => {
  const env = { USERPROFILE: 'C:\\Users\\someone', Notes: 'vault' };
  assert.equal(
    expandFolder('%USERPROFILE%\\Documents\\Assistant', env, home),
    'C:\\Users\\someone\\Documents\\Assistant',
  );
  assert.equal(expandFolder('%userprofile%\\x', env, home), 'C:\\Users\\someone\\x');
  assert.equal(expandFolder('/data/${NOTES}', env, home), '/data/vault');
  assert.equal(expandFolder('~/notes', env, home), path.join(home, 'notes'));
  assert.equal(expandFolder('~', env, home), home);
});

test('leaves unknown variables as written', () => {
  assert.equal(expandFolder('%NOPE%\\x', {}, home), '%NOPE%\\x');
});
