import crypto from 'node:crypto';
import type { MCPFileOutput } from './types';

/** Artifact key under which `formatToolContent` hands file outputs to the tool-end callback. */
export const MCP_FILE_OUTPUTS_KEY = 'mcp_files' as const;

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/html': 'html',
};

const UNSAFE_NAME = /[<>:"/\\|?*\p{Cc}]+/gu;

function lastSegment(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0] ?? '';
  const segment = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    /* A malformed escape keeps the raw segment. */
  }
  return decoded.slice(Math.max(decoded.lastIndexOf('/'), decoded.lastIndexOf('\\')) + 1);
}

/**
 * Names the attachment after the last segment of the resource URI, the only name an embedded
 * resource carries, made safe for every storage strategy. A name without an extension gets one
 * from the MIME type so the client can pick a viewer.
 */
export function filenameFromUri(uri: string, mimeType: string): string {
  const cleaned = lastSegment(uri).replace(UNSAFE_NAME, ' ').replace(/\s+/g, ' ').trim();
  const base = cleaned.replace(/^\.+/, '').slice(0, 120).trim() || 'file';
  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) {
    return base;
  }
  const extension = EXTENSIONS[mimeType.toLowerCase()];
  return extension ? `${base}.${extension}` : base;
}

function estimateBytes(base64: string): number {
  const padding = base64.length - base64.replace(/=+$/, '').length;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function toMCPFileOutput(
  resource: { uri: string; mimeType?: string; blob: string },
  serverName: string,
): MCPFileOutput {
  const mimeType = resource.mimeType || 'application/octet-stream';
  return {
    serverName,
    uri: resource.uri,
    filename: filenameFromUri(resource.uri, mimeType),
    mimeType,
    data: resource.blob,
    bytes: estimateBytes(resource.blob),
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The line the model reads in place of the file's bytes. */
export function describeMCPFileOutput(file: MCPFileOutput): string {
  return `File attached to the chat for the user: ${file.filename} (${file.mimeType}, ${formatSize(file.bytes)})`;
}

export interface PreparedMCPFileOutput {
  /** Stable per server and URI, so re-sending the same resource names the same stored file. */
  id: string;
  name: string;
  /** Stands in for the code-environment session the shared file-output pipeline records. */
  sessionId: string;
  buffer: Buffer;
}

export interface PreparedMCPFileOutputs {
  ready: PreparedMCPFileOutput[];
  /** Files over the size limit, by name; they are dropped rather than stored. */
  oversized: string[];
}

/**
 * Decodes file outputs for storage, dropping any over `maxBytes` (the endpoint's upload size
 * limit) before they reach the pipeline, whose own over-limit path points at a code sandbox
 * download URL that an MCP server does not have.
 */
export function prepareMCPFileOutputs(
  files: readonly MCPFileOutput[],
  maxBytes: number,
): PreparedMCPFileOutputs {
  const ready: PreparedMCPFileOutput[] = [];
  const oversized: string[] = [];
  for (const file of files) {
    const buffer = Buffer.from(file.data, 'base64');
    if (buffer.byteLength > maxBytes) {
      oversized.push(file.filename);
      continue;
    }
    const id = crypto
      .createHash('sha256')
      .update(`${file.serverName}\u0000${file.uri}`)
      .digest('hex')
      .slice(0, 32);
    ready.push({ id, name: file.filename, sessionId: `mcp_${file.serverName}`, buffer });
  }
  return { ready, oversized };
}
