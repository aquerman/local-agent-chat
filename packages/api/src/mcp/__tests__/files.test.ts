import { filenameFromUri, prepareMCPFileOutputs, toMCPFileOutput } from '../files';

describe('filenameFromUri', () => {
  it('uses the decoded last URI segment', () => {
    expect(filenameFromUri('documents://abc/Q3%20report.docx', 'application/pdf')).toBe(
      'Q3 report.docx',
    );
    expect(filenameFromUri('file:///tmp/out.csv?x=1#y', 'text/csv')).toBe('out.csv');
  });

  it('strips unsafe characters and leading dots', () => {
    expect(filenameFromUri('x://a/..%2F..%2Fsecret%3A.txt', 'text/plain')).toBe('secret .txt');
    expect(filenameFromUri('x://a/.env', 'text/plain')).toBe('env.txt');
    expect(filenameFromUri('x://a/%E0%A4%A', 'text/plain')).toBe('%E0%A4%A.txt');
  });

  it('adds an extension from the MIME type when missing', () => {
    expect(
      filenameFromUri(
        'documents://abc/deck',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe('deck.pptx');
    expect(filenameFromUri('documents://abc/', 'application/x-unknown')).toBe('file');
  });
});

describe('prepareMCPFileOutputs', () => {
  const output = (uri: string, bytes: number) =>
    toMCPFileOutput(
      { uri, mimeType: 'application/pdf', blob: Buffer.alloc(bytes, 7).toString('base64') },
      'documents',
    );

  it('decodes files, keeps ids stable per server and URI, and drops oversized ones', () => {
    const { ready, oversized } = prepareMCPFileOutputs(
      [
        output('documents://a/one.pdf', 5),
        output('documents://a/big.pdf', 50),
        output('documents://a/one.pdf', 3),
      ],
      10,
    );

    expect(oversized).toEqual(['big.pdf']);
    expect(ready).toHaveLength(2);
    expect(ready[0]).toMatchObject({ name: 'one.pdf', sessionId: 'mcp_documents' });
    expect(ready[0].buffer.equals(Buffer.alloc(5, 7))).toBe(true);
    expect(ready[0].id).toBe(ready[1].id);
    expect(ready[0].id).toMatch(/^[a-f0-9]{32}$/);
  });

  it('estimates the decoded size for the model-facing summary', () => {
    expect(output('documents://a/x.pdf', 1000).bytes).toBe(1000);
  });
});
