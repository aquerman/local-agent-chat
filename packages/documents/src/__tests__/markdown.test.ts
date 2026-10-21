import { parseMarkdown, plainText } from '~/markdown';

describe('parseMarkdown', () => {
  it('maps headings, paragraphs and inline styles', () => {
    const blocks = parseMarkdown(
      '## Plan\n\nSome **bold**, *italic*, `code` and [a link](https://example.com) & more.',
    );
    expect(blocks[0]).toEqual({ type: 'heading', level: 2, inlines: [{ text: 'Plan' }] });
    const paragraph = blocks[1];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type !== 'paragraph') return;
    expect(paragraph.inlines).toEqual(
      expect.arrayContaining([
        { text: 'bold', bold: true },
        { text: 'italic', italic: true },
        { text: 'code', code: true },
        { text: 'a link', link: 'https://example.com' },
      ]),
    );
    expect(plainText(paragraph.inlines)).toBe('Some bold, italic, code and a link & more.');
  });

  it('keeps nested lists, ordered starts, tables, code and quotes', () => {
    const blocks = parseMarkdown(
      [
        '3. three',
        '4. four',
        '   - nested',
        '',
        '| A | B |',
        '|:--|--:|',
        '| 1 | <b>2</b> |',
        '',
        '```ts',
        'const a = 1 < 2;',
        '```',
        '',
        '> quoted',
        '',
        '---',
      ].join('\n'),
    );
    expect(blocks.map((block) => block.type)).toEqual(['list', 'table', 'code', 'quote', 'rule']);
    const [list, table, code] = blocks;
    if (list.type !== 'list' || table.type !== 'table' || code.type !== 'code') return;
    expect(list).toMatchObject({ ordered: true, start: 3 });
    expect(list.items[1].blocks.map((block) => block.type)).toEqual(['paragraph', 'list']);
    expect(table.align).toEqual(['left', 'right']);
    expect(plainText(table.rows[0][1])).toBe('<b>2</b>');
    expect(code).toEqual({ type: 'code', lang: 'ts', text: 'const a = 1 < 2;' });
  });
});
