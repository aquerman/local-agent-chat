import path from 'node:path';

/** Name of the variable that lists the folders, one entry per allowed directory. */
export const FOLDERS_VAR = 'BENNY_FOLDERS';

/** Folder used when BENNY_FOLDERS is not set: `<home>/Documents/Assistant`. */
export function defaultFolder(home) {
  return path.join(home, 'Documents', 'Assistant');
}

/**
 * Expands `%NAME%` (Windows style), `${NAME}` and a leading `~` in one folder entry.
 * Unknown variables are left as written so the server reports the path it could not open.
 * @param {string} entry
 * @param {Record<string, string | undefined>} env
 * @param {string} home
 * @returns {string}
 */
export function expandFolder(entry, env, home) {
  const lookup = (name) => {
    const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
    return key === undefined ? undefined : env[key];
  };
  const expanded = entry
    .replace(/%([^%]+)%/g, (match, name) => lookup(name) ?? match)
    .replace(/\$\{([^}]+)\}/g, (match, name) => lookup(name) ?? match);
  if (expanded === '~') {
    return home;
  }
  if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    return path.join(home, expanded.slice(2));
  }
  return expanded;
}

/**
 * Resolves the allowed folders from the environment.
 *
 * BENNY_FOLDERS holds one or more folders separated by the platform's path delimiter
 * (`;` on Windows, `:` elsewhere), the same rule as PATH. When it is empty, unset, or still the
 * literal `${BENNY_FOLDERS}` (LibreChat passes the placeholder through when .env lacks the key),
 * the default folder is used and `isDefault` is true so the caller can create it.
 * @param {Record<string, string | undefined>} env
 * @param {{ home: string, delimiter?: string }} options
 * @returns {{ folders: string[], isDefault: boolean }}
 */
export function resolveFolders(env, { home, delimiter = path.delimiter }) {
  const raw = (env[FOLDERS_VAR] ?? '').trim();
  const folders = /^\$\{[^}]*\}$/.test(raw)
    ? []
    : raw
        .split(delimiter)
        .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1').trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => expandFolder(entry, env, home));
  if (folders.length > 0) {
    return { folders: [...new Set(folders)], isDefault: false };
  }
  return { folders: [defaultFolder(home)], isDefault: true };
}
