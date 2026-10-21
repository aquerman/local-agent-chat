import JSZip from 'jszip';
import { dropMissingParts, fitSlideWidth, readSlideOutline } from '../office';

jest.mock('pptx-preview', () => ({ init: jest.fn() }));
jest.mock('docx-preview', () => ({ renderAsync: jest.fn() }));

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const shape = (paragraphs: string[], placeholder?: string) =>
  `<p:sp><p:nvSpPr><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs
    .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
    .join('')}</p:txBody></p:sp>`;

const slide = (...shapes: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;

const contentTypes = (parts: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/>${parts
    .map((part) => `<Override PartName="/${part}" ContentType="application/xml"/>`)
    .join('')}</Types>`;

describe('dropMissingParts', () => {
  it('removes overrides for parts the zip does not contain, as pptxgenjs writes them', async () => {
    const zip = new JSZip();
    zip.file('ppt/slideMasters/slideMaster1.xml', '<x/>');
    zip.file(
      '[Content_Types].xml',
      contentTypes(['ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/slideMaster2.xml']),
    );

    await expect(dropMissingParts(zip)).resolves.toBe(1);

    const repaired = await zip.file('[Content_Types].xml')!.async('text');
    expect(repaired).toContain('/ppt/slideMasters/slideMaster1.xml');
    expect(repaired).not.toContain('slideMaster2');
  });

  it('leaves a complete package untouched', async () => {
    const zip = new JSZip();
    const types = contentTypes(['ppt/presentation.xml']);
    zip.file('ppt/presentation.xml', '<x/>');
    zip.file('[Content_Types].xml', types);

    await expect(dropMissingParts(zip)).resolves.toBe(0);
    await expect(zip.file('[Content_Types].xml')!.async('text')).resolves.toBe(types);
  });
});

describe('readSlideOutline', () => {
  it('reads each slide title and text in slide order', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide10.xml', slide(shape(['Last'], 'title')));
    zip.file(
      'ppt/slides/slide2.xml',
      slide(shape(['Revenue up', 'Two hires']), shape(['Highlights'], 'title')),
    );
    zip.file('ppt/slides/slide1.xml', slide(shape(['Quarterly Review'], 'ctrTitle')));
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<x/>');

    await expect(readSlideOutline(zip)).resolves.toEqual([
      { number: 1, title: 'Quarterly Review', lines: [] },
      { number: 2, title: 'Highlights', lines: ['Revenue up', 'Two hires'] },
      { number: 10, title: 'Last', lines: [] },
    ]);
  });

  it('uses the first line as the title when no title placeholder exists', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slide(shape(['Agenda', '', 'Item one'])));

    await expect(readSlideOutline(zip)).resolves.toEqual([
      { number: 1, title: 'Agenda', lines: ['Item one'] },
    ]);
  });
});

describe('fitSlideWidth', () => {
  it('fits the panel without growing past a readable size or collapsing', () => {
    expect(fitSlideWidth(500.7)).toBe(500);
    expect(fitSlideWidth(2000)).toBe(960);
    expect(fitSlideWidth(40)).toBe(160);
  });
});
