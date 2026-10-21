import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { StoredDocument, DocumentStore } from '~/store';
import type { LaunchBrowser } from '~/pdf';
import type { Config } from '~/config';
import type { Slide } from '~/slides';
import { FORMATS, MIME_TYPES, createStore, toFilename, newDocumentId } from '~/store';
import { slideSchema, parseOutline } from '~/slides';
import { renderDocument } from '~/render';
import { DocumentsError } from '~/errors';

export interface ServerOptions {
  config: Config;
  store?: DocumentStore;
  launch?: LaunchBrowser;
}

const LABELS = {
  docx: 'Word document',
  pdf: 'PDF',
  pptx: 'PowerPoint deck',
  md: 'Markdown file',
} as const;

const CREATE_DESCRIPTION =
  'Create a Word (docx), PDF, PowerPoint (pptx) or Markdown (md) file and attach it to the chat for the user to download. ' +
  'You write only the content; fonts, headings and layout come from a built-in style. ' +
  'docx/pdf/md: content is Markdown (headings, lists, tables, code blocks; no title heading, it is added from title). ' +
  'pptx: give slides (a title slide is added from title). ' +
  'For a long document, create it with the first section, then call append_section once per further section.';

const APPEND_DESCRIPTION =
  'Add the next section (Markdown) or more slides to a file made by create_document, and attach the updated file. ' +
  'Only for long documents written one section at a time; a short document needs a single create_document call.';

const slidesParam = z
  .array(slideSchema)
  .optional()
  .describe(
    'pptx only: the slides. A slide with left/right is two-column; one with only title/subtitle is a divider.',
  );

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof DocumentsError) {
    return err.message;
  }
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`documents: unexpected error: ${reason}\n`);
  return `${fallback}: ${reason}`;
}

function kilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Resolves the slides of one call: the structured parameter first, else an outline in `content`. */
function slidesFrom(slides: Slide[] | undefined, content: string | undefined): Slide[] {
  if (slides !== undefined && slides.length > 0) {
    return slides;
  }
  if (content !== undefined && content.trim() !== '') {
    return parseOutline(content);
  }
  return [];
}

interface Part {
  sections: string[];
  slides: Slide[];
}

function partFor(doc: Pick<StoredDocument, 'format'>, content?: string, slides?: Slide[]): Part {
  if (doc.format === 'pptx') {
    const parsed = slidesFrom(slides, content);
    if (parsed.length === 0) {
      throw new DocumentsError(
        'No slides given: pass slides as [{title, bullets}] (or an outline in content).',
      );
    }
    return { sections: [], slides: parsed };
  }
  if (content === undefined || content.trim() === '') {
    throw new DocumentsError('No content given: pass the section text as Markdown in content.');
  }
  return { sections: [content], slides: [] };
}

export function createServer(options: ServerOptions): McpServer {
  const { config, launch } = options;
  const store = options.store ?? createStore(config.outputDir);
  const server = new McpServer({ name: 'librechat-documents', version: '0.1.0' });

  const publish = async (doc: StoredDocument, action: string): Promise<CallToolResult> => {
    const parts = doc.format === 'pptx' ? doc.slides.length : doc.sections.length;
    if (parts > config.maxParts) {
      throw new DocumentsError(`The document is limited to ${config.maxParts} sections or slides.`);
    }
    const { file, extent } = await renderDocument(doc, config, launch);
    if (file.byteLength > config.maxBytes) {
      throw new DocumentsError(
        `The rendered file is ${kilobytes(file.byteLength)}, above the ${kilobytes(config.maxBytes)} limit (DOCUMENTS_MAX_BYTES).`,
      );
    }
    await store.save(doc);
    const savedTo = await store.writeOutput(doc, file);
    const summary = [
      `${action} "${doc.filename}" (${LABELS[doc.format]}, ${extent}, ${kilobytes(file.byteLength)}).`,
      'It is attached to the chat for the user to download; do not repeat its content in your reply.',
      `document_id: ${doc.id} (only needed to append a further section of a long document).`,
      `Saved at: ${savedTo}`,
    ].join('\n');
    return {
      content: [
        { type: 'text', text: summary },
        {
          type: 'resource',
          resource: {
            uri: `documents://${doc.id}/${encodeURIComponent(doc.filename)}`,
            mimeType: MIME_TYPES[doc.format],
            blob: file.toString('base64'),
          },
        },
      ],
    };
  };

  server.registerTool(
    'create_document',
    {
      title: 'Create document',
      description: CREATE_DESCRIPTION,
      inputSchema: {
        format: z.enum(FORMATS).describe('docx (Word), pdf, pptx (slides) or md (Markdown)'),
        title: z.string().min(1).describe('Document title; also names the file'),
        content: z
          .string()
          .optional()
          .describe('docx/pdf/md: the body (or its first section) as Markdown'),
        slides: slidesParam,
      },
    },
    async ({ format, title, content, slides }) => {
      try {
        const part = partFor({ format }, content, slides);
        const doc: StoredDocument = {
          id: newDocumentId(),
          format,
          title: title.trim(),
          filename: toFilename(title, format),
          ...part,
        };
        return await publish(doc, 'Created');
      } catch (err) {
        return errorResult(toMessage(err, 'Could not create the document'));
      }
    },
  );

  server.registerTool(
    'append_section',
    {
      title: 'Append section',
      description: APPEND_DESCRIPTION,
      inputSchema: {
        document_id: z.string().min(1).describe('The document_id create_document returned'),
        content: z
          .string()
          .optional()
          .describe('docx/pdf/md: the next section as Markdown, starting with its ## heading'),
        slides: slidesParam,
      },
    },
    async ({ document_id, content, slides }) => {
      try {
        const doc = await store.load(document_id);
        const part = partFor(doc, content, slides);
        const updated: StoredDocument = {
          ...doc,
          sections: [...doc.sections, ...part.sections],
          slides: [...doc.slides, ...part.slides],
        };
        return await publish(updated, 'Updated');
      } catch (err) {
        return errorResult(toMessage(err, 'Could not append to the document'));
      }
    },
  );

  return server;
}
