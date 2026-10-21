import type { StoredDocument } from '~/store';
import type { LaunchBrowser } from '~/pdf';
import type { Config } from '~/config';
import { renderPdf, countPdfPages } from '~/pdf';
import { renderPptx } from '~/slides';
import { renderDocx } from '~/docx';

export interface Rendered {
  file: Buffer;
  /** A short size note for the tool result, such as "3 pages" or "6 slides". */
  extent: string;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A Markdown file: the title as its only `#` heading, then the sections as written. */
export function joinMarkdown(title: string, sections: string[]): string {
  const body = sections.map((section) => section.trim()).filter((section) => section !== '');
  return `${[`# ${title}`, ...body].join('\n\n')}\n`;
}

export async function renderDocument(
  doc: StoredDocument,
  config: Config,
  launch?: LaunchBrowser,
): Promise<Rendered> {
  const { title, sections, slides } = doc;
  switch (doc.format) {
    case 'docx': {
      const file = await renderDocx({ title, sections, pageSize: config.pageSize });
      return { file, extent: plural(sections.length, 'section') };
    }
    case 'pdf': {
      const file = await renderPdf({
        title,
        sections,
        pageSize: config.pageSize,
        browser: config.browser,
        launch,
      });
      return { file, extent: plural(countPdfPages(file), 'page') };
    }
    case 'md': {
      const file = Buffer.from(joinMarkdown(title, sections), 'utf8');
      return { file, extent: plural(sections.length, 'section') };
    }
    case 'pptx': {
      const file = await renderPptx({ title, slides });
      return { file, extent: plural(slides.length + 1, 'slide') };
    }
  }
}
