import { renderPdf, countPdfPages } from '~/pdf';
import { DocumentsError } from '~/errors';
import { renderPptx } from '~/slides';
import { renderDocx } from '~/docx';
import { buildHtml } from '~/html';
import { testBrowser, zipText } from './helpers';

const SECTION = [
  '## Summary',
  '',
  'The **plan** has three parts & a [link](https://example.com).',
  '',
  '- First point',
  '  - Nested point',
  '1. Step one',
  '2. Step two',
  '',
  '| Item | Cost |',
  '|---|--:|',
  '| Disk | 40 |',
  '',
  '```',
  'npm run build',
  '```',
  '',
  '> A quote.',
].join('\n');

describe('renderDocx', () => {
  it('writes the title, headings, lists, table and code into word/document.xml', async () => {
    const file = await renderDocx({
      title: 'Quarterly Plan',
      sections: [SECTION, '## Next\n\nMore text.'],
      pageSize: 'A4',
    });
    const parts = await zipText(file, /^word\/(document|numbering|styles)\.xml$/);
    const xml = parts['word/document.xml'];
    expect(xml).toContain('Quarterly Plan');
    expect(xml).toContain('w:val="Title"');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('The </w:t>');
    expect(xml).toContain('three parts &amp; a ');
    expect(xml).toContain('Nested point');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Disk');
    expect(xml).toContain('npm run build');
    expect(xml).toContain('Consolas');
    expect(xml).toContain('More text.');
    expect(xml).toContain('w:w="11906"');
    expect(parts['word/numbering.xml']).toContain('decimal');
  });

  it('uses Letter size when asked', async () => {
    const file = await renderDocx({ title: 'T', sections: ['x'], pageSize: 'Letter' });
    const { 'word/document.xml': xml } = await zipText(file, /^word\/document\.xml$/);
    expect(xml).toContain('w:w="12240"');
  });
});

describe('renderPptx', () => {
  it('adds a title slide and one slide per outline entry in each layout', async () => {
    const file = await renderPptx({
      title: 'Roadmap',
      slides: [
        { title: 'Goals', bullets: ['Ship it', '  Soon'], notes: 'Say hello' },
        {
          title: 'Trade-offs',
          left: ['Fast'],
          right: ['Cheap'],
          leftTitle: 'Pros',
          rightTitle: 'Cons',
        },
        { title: 'Part 2', subtitle: 'Details' },
      ],
    });
    const slides = await zipText(file, /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/);
    const slideNames = Object.keys(slides).filter((name) => name.startsWith('ppt/slides/'));
    expect(slideNames.sort()).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide3.xml',
      'ppt/slides/slide4.xml',
    ]);
    expect(slides['ppt/slides/slide1.xml']).toContain('Roadmap');
    expect(slides['ppt/slides/slide2.xml']).toContain('Ship it');
    expect(slides['ppt/slides/slide2.xml']).toContain('lvl="1"');
    expect(slides['ppt/slides/slide3.xml']).toContain('Fast');
    expect(slides['ppt/slides/slide3.xml']).toContain('Cheap');
    expect(slides['ppt/slides/slide3.xml']).toContain('Pros');
    expect(slides['ppt/slides/slide4.xml']).toContain('Details');
    expect(Object.values(slides).some((xml) => xml.includes('Say hello'))).toBe(true);
  });
});

describe('buildHtml', () => {
  it('shows raw HTML as text and drops images', () => {
    const html = buildHtml('T <x>', [
      '<script>alert(1)</script>\n\n![chart](http://example.com/a.png)',
    ]);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('[image: chart]');
    expect(html).toContain('<title>T &lt;x&gt;</title>');
  });
});

describe('renderPdf', () => {
  it('prints a PDF whose page count grows with the content', async () => {
    const short = await renderPdf({
      title: 'Short',
      sections: [SECTION],
      pageSize: 'A4',
      browser: testBrowser,
    });
    expect(short.subarray(0, 5).toString()).toBe('%PDF-');
    expect(countPdfPages(short)).toBe(1);

    const long = Array.from(
      { length: 12 },
      (_, i) => `## Part ${i + 1}\n\n${'Lorem ipsum dolor sit amet. '.repeat(40)}`,
    );
    const file = await renderPdf({
      title: 'Long',
      sections: long,
      pageSize: 'A4',
      browser: testBrowser,
    });
    expect(countPdfPages(file)).toBeGreaterThan(2);
  });

  it('says how to configure the browser when it cannot start', async () => {
    const launch = () => Promise.reject(new Error('Executable does not exist\nmore'));
    await expect(
      renderPdf({
        title: 'T',
        sections: ['x'],
        pageSize: 'A4',
        browser: { channel: 'msedge' },
        launch,
      }),
    ).rejects.toThrow(DocumentsError);
    await expect(
      renderPdf({
        title: 'T',
        sections: ['x'],
        pageSize: 'A4',
        browser: { channel: 'msedge' },
        launch,
      }),
    ).rejects.toThrow(
      /installed "msedge" browser: Executable does not exist\. Set DOCUMENTS_BROWSER_PATH/,
    );
  });
});
