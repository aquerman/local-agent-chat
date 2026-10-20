import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Slide } from '~/slides';
import { DocumentsError } from '~/errors';

export const FORMATS = ['docx', 'pdf', 'pptx'] as const;
export type Format = (typeof FORMATS)[number];

export const MIME_TYPES: Record<Format, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** What a document is made from. The file is re-rendered from this after every append. */
export interface StoredDocument {
  id: string;
  format: Format;
  title: string;
  filename: string;
  /** Markdown sections, for docx and pdf. */
  sections: string[];
  /** Slide outline, for pptx. */
  slides: Slide[];
}

const ID_PATTERN = /^[a-f0-9]{10}$/;
const UNSAFE_FILENAME = /[<>:"/\\|?*\p{Cc}]+/gu;

export function newDocumentId(): string {
  return crypto.randomBytes(5).toString('hex');
}

/** A filename that is valid on Windows, derived from the title. */
export function toFilename(title: string, format: Format): string {
  const base = title
    .replace(UNSAFE_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const short = base.slice(0, 80).trim();
  return `${short === '' ? 'document' : short}.${format}`;
}

export interface DocumentStore {
  save: (doc: StoredDocument) => Promise<void>;
  load: (id: string) => Promise<StoredDocument>;
  /** Writes the rendered file next to its source and returns its path. */
  writeOutput: (doc: StoredDocument, file: Buffer) => Promise<string>;
}

/** Keeps each document in `<dir>/<id>/`: its source as JSON and the last rendered file. */
export function createStore(dir: string): DocumentStore {
  const folder = (id: string): string => path.join(dir, id);
  const sourcePath = (id: string): string => path.join(folder(id), 'source.json');

  return {
    async save(doc) {
      await mkdir(folder(doc.id), { recursive: true });
      await writeFile(sourcePath(doc.id), JSON.stringify(doc), 'utf8');
    },
    async load(rawId) {
      const id = rawId.trim().toLowerCase();
      if (!ID_PATTERN.test(id)) {
        throw new DocumentsError(
          `Unknown document_id "${rawId}". Use the document_id that create_document returned.`,
        );
      }
      try {
        return JSON.parse(await readFile(sourcePath(id), 'utf8')) as StoredDocument;
      } catch {
        throw new DocumentsError(
          `No document with document_id "${id}". Call create_document to start a new one.`,
        );
      }
    },
    async writeOutput(doc, file) {
      const target = path.join(folder(doc.id), doc.filename);
      await writeFile(target, file);
      return target;
    },
  };
}
