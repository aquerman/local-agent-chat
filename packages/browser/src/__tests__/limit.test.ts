import { EMPTY_RESULT_NOTE, limitResult, reportedPageUrl } from '~/limit';

describe('limitResult', () => {
  it('passes short text through and drops images', () => {
    const result = limitResult(
      {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
      },
      100,
    );
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('replaces an empty success with a hint', () => {
    expect(limitResult({ content: [] }, 100).content).toEqual([
      { type: 'text', text: EMPTY_RESULT_NOTE },
    ]);
  });

  it('cuts long text on a line break and says how to read the rest', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `- listitem ${i} [ref=e${i}]`);
    const result = limitResult({ content: [{ type: 'text', text: lines.join('\n') }] }, 300);
    const [part] = result.content;
    expect(part.type).toBe('text');
    const text = part.type === 'text' ? part.text : '';
    const [kept, note] = text.split('\n\n[');
    expect(kept.length).toBeLessThanOrEqual(300);
    expect(kept.endsWith(']')).toBe(true);
    expect(note).toMatch(/^Cut at \d+ of \d+ characters\. .*browser_find/);
  });

  it('keeps the error flag', () => {
    expect(limitResult({ content: [{ type: 'text', text: 'x' }], isError: true }, 10).isError).toBe(
      true,
    );
  });
});

describe('reportedPageUrl', () => {
  it('reads the Page URL line', () => {
    const text = '### Page\n- Page URL: https://a.com/x\n- Page Title: A';
    expect(reportedPageUrl({ content: [{ type: 'text', text }] })).toBe('https://a.com/x');
    expect(reportedPageUrl({ content: [{ type: 'text', text: 'Done' }] })).toBeUndefined();
  });
});
