#!/usr/bin/env node
/**
 * Starts the reference filesystem MCP server (@modelcontextprotocol/server-filesystem, installed
 * as a dependency so nothing is downloaded at launch) with the folders from BENNY_FOLDERS as its
 * allowed directories. The server reads them from argv, so they are set before it is imported.
 */
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import { resolveFolders } from './folders.mjs';

const { folders, isDefault } = resolveFolders(process.env, { home: os.homedir() });

if (isDefault) {
  try {
    mkdirSync(folders[0], { recursive: true });
  } catch (error) {
    console.error(`folders: cannot create default folder ${folders[0]}: ${error.message}`);
  }
}

console.error(`folders: allowed directories: ${folders.join(', ')}`);
process.argv = [process.argv[0], process.argv[1], ...folders];

await import('@modelcontextprotocol/server-filesystem/dist/index.js');
