import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MIME_TYPES } from '~/store';
import { createServer } from '~/server';
import { testConfig, zipText } from './helpers';

interface ToolResult {
  isError?: boolean;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'resource'; resource: { uri: string; mimeType?: string; blob?: string } }
  >;
}

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'documents-test-'));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ config: testConfig(dir) }).connect(serverTransport);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function textOf(result: ToolResult): string {
  const part = result.content.find((item) => item.type === 'text');
  return part?.type === 'text' ? part.text : '';
}

function fileOf(result: ToolResult): { uri: string; mimeType?: string; file: Buffer } {
  const part = result.content.find((item) => item.type === 'resource');
  if (part?.type !== 'resource' || part.resource.blob === undefined) {
    throw new Error('no file in result');
  }
  return { ...part.resource, file: Buffer.from(part.resource.blob, 'base64') };
}

describe('documents server', () => {
  it('lists the two tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['append_section', 'create_document']);
  });

  it('creates a docx, then appends a section to the same file', async () => {
    const created = await call('create_document', {
      format: 'docx',
      title: 'Trip: Plan / 2026',
      content: '## Day 1\n\nArrive.',
    });
    expect(created.isError).toBeUndefined();
    const id = textOf(created).match(/document_id: ([a-f0-9]+)/)?.[1];
    expect(id).toBeDefined();
    const first = fileOf(created);
    expect(first.mimeType).toBe(MIME_TYPES.docx);
    expect(first.uri).toBe(`documents://${id}/${encodeURIComponent('Trip Plan 2026.docx')}`);

    const appended = await call('append_section', {
      document_id: id,
      content: '## Day 2\n\nHike.',
    });
    expect(textOf(appended)).toContain('Updated "Trip Plan 2026.docx" (Word document, 2 sections');
    const { file, uri } = fileOf(appended);
    expect(uri).toBe(first.uri);
    const { 'word/document.xml': xml } = await zipText(file, /^word\/document\.xml$/);
    expect(xml).toContain('Arrive.');
    expect(xml).toContain('Hike.');
    const saved = await readFile(path.join(dir, id!, 'Trip Plan 2026.docx'));
    expect(saved.equals(file)).toBe(true);
  });

  it('creates a pptx from slides and appends a Markdown outline', async () => {
    const created = await call('create_document', {
      format: 'pptx',
      title: 'Pitch',
      slides: [{ title: 'Problem', bullets: ['Too slow'] }],
    });
    const id = textOf(created).match(/document_id: ([a-f0-9]+)/)?.[1];
    expect(textOf(created)).toContain('2 slides');
    const appended = await call('append_section', {
      document_id: id,
      content: '## Fix\n- Local model',
    });
    expect(textOf(appended)).toContain('3 slides');
    const slides = await zipText(fileOf(appended).file, /^ppt\/slides\/slide\d+\.xml$/);
    expect(slides['ppt/slides/slide3.xml']).toContain('Local model');
  });

  it('creates a PDF', async () => {
    const created = await call('create_document', {
      format: 'pdf',
      title: 'Note',
      content: 'Hello.',
    });
    expect(textOf(created)).toContain('(PDF, 1 page,');
    expect(fileOf(created).file.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns errors the model can act on', async () => {
    const empty = await call('create_document', { format: 'docx', title: 'T' });
    expect(empty).toMatchObject({ isError: true });
    expect(textOf(empty)).toContain('pass the section text as Markdown');

    const noSlides = await call('create_document', { format: 'pptx', title: 'T', content: '  ' });
    expect(textOf(noSlides)).toContain('No slides given');

    const unknown = await call('append_section', { document_id: '../../etc', content: 'x' });
    expect(textOf(unknown)).toContain('Unknown document_id');

    const missing = await call('append_section', { document_id: 'abcdef0123', content: 'x' });
    expect(textOf(missing)).toContain('No document with document_id');
  });
});
