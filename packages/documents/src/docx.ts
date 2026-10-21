import {
  Table,
  Footer,
  Packer,
  TextRun,
  Document,
  TableRow,
  WidthType,
  Paragraph,
  TableCell,
  PageNumber,
  BorderStyle,
  LevelFormat,
  ShadingType,
  HeadingLevel,
  AlignmentType,
  ExternalHyperlink,
} from 'docx';
import type { ParagraphChild } from 'docx';
import type { Block, Inline, ListItem } from '~/markdown';
import type { PageSize } from '~/config';
import { parseMarkdown } from '~/markdown';
import { THEME } from '~/theme';

type DocxChild = Paragraph | Table;

interface Context {
  /** Nesting depth of the list being rendered, 0 at the top. */
  listLevel: number;
  quote: boolean;
  /** Numbering instance, so every ordered list restarts at 1. */
  nextInstance: () => number;
}

const ORDERED = 'ordered';
const INDENT_STEP = 720;
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/** Page sizes in twentieths of a point. */
const PAGE_SIZES: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
};

const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

function run(inline: Inline, extra: { bold?: boolean } = {}): TextRun {
  return new TextRun({
    text: inline.text,
    bold: inline.bold === true || extra.bold === true,
    italics: inline.italic,
    strike: inline.strike,
    break: inline.breakBefore === true ? 1 : undefined,
    font: inline.code === true ? THEME.monoFont : undefined,
    shading:
      inline.code === true
        ? { type: ShadingType.CLEAR, fill: THEME.codeBackground, color: 'auto' }
        : undefined,
    style: inline.link !== undefined ? 'Hyperlink' : undefined,
  });
}

function runs(inlines: Inline[], extra: { bold?: boolean } = {}): ParagraphChild[] {
  return inlines.map((inline) =>
    inline.link !== undefined
      ? new ExternalHyperlink({ link: inline.link, children: [run(inline, extra)] })
      : run(inline, extra),
  );
}

function quoteStyle(ctx: Context): Partial<ConstructorParameters<typeof Paragraph>[0] & object> {
  if (!ctx.quote) {
    return {};
  }
  return {
    indent: { left: INDENT_STEP / 2 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: THEME.ruleColor, space: 10 },
    },
  };
}

function paragraph(inlines: Inline[], ctx: Context): Paragraph {
  const children = runs(
    ctx.quote ? inlines.map((inline) => ({ ...inline, italic: true })) : inlines,
  );
  const indent = ctx.listLevel > 0 ? { left: INDENT_STEP * ctx.listLevel } : undefined;
  return new Paragraph({ children, indent, ...quoteStyle(ctx) });
}

function codeBlock(text: string): Paragraph[] {
  const lines = text.split('\n');
  return lines.map(
    (line, index) =>
      new Paragraph({
        children: [new TextRun({ text: line === '' ? ' ' : line, font: THEME.monoFont, size: 19 })],
        shading: { type: ShadingType.CLEAR, fill: THEME.codeBackground, color: 'auto' },
        spacing: { before: index === 0 ? 120 : 0, after: index === lines.length - 1 ? 120 : 0 },
        indent: { left: 144, right: 144 },
      }),
  );
}

function tableCell(
  inlines: Inline[],
  align: 'left' | 'center' | 'right' | null,
  header: boolean,
): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: runs(inlines, { bold: header }),
        alignment: align === null ? undefined : ALIGNMENTS[align],
        spacing: { before: 40, after: 40 },
      }),
    ],
    shading: header
      ? { type: ShadingType.CLEAR, fill: THEME.tableHeaderBackground, color: 'auto' }
      : undefined,
    margins: { left: 100, right: 100 },
  });
}

function table(block: Extract<Block, { type: 'table' }>): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: THEME.ruleColor };
  const header = new TableRow({
    tableHeader: true,
    children: block.header.map((cell, index) => tableCell(cell, block.align[index] ?? null, true)),
  });
  const rows = block.rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell, index) => tableCell(cell, block.align[index] ?? null, false)),
      }),
  );
  return new Table({
    rows: [header, ...rows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
  });
}

function listItem(item: ListItem, ordered: boolean, instance: number, ctx: Context): DocxChild[] {
  const level = ctx.listLevel;
  const nested: Context = { ...ctx, listLevel: level + 1 };
  return item.blocks.flatMap((block, index) => {
    if (index > 0 || block.type !== 'paragraph') {
      return renderBlock(block, nested);
    }
    const marker = ordered
      ? { numbering: { reference: ORDERED, level: Math.min(level, 4), instance } }
      : { bullet: { level: Math.min(level, 4) } };
    return [new Paragraph({ children: runs(block.inlines), ...marker, ...quoteStyle(ctx) })];
  });
}

function renderBlock(block: Block, ctx: Context): DocxChild[] {
  switch (block.type) {
    case 'heading':
      return [
        new Paragraph({
          heading: HEADINGS[Math.min(block.level, 6) - 1],
          children: runs(block.inlines),
        }),
      ];
    case 'paragraph':
      return [paragraph(block.inlines, ctx)];
    case 'list': {
      const instance = ctx.nextInstance();
      return block.items.flatMap((item) => listItem(item, block.ordered, instance, ctx));
    }
    case 'code':
      return codeBlock(block.text);
    case 'table':
      return [table(block), new Paragraph({ children: [] })];
    case 'quote':
      return block.blocks.flatMap((child) => renderBlock(child, { ...ctx, quote: true }));
    case 'rule':
      return [
        new Paragraph({
          children: [],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: THEME.ruleColor, space: 1 },
          },
        }),
      ];
  }
}

const ORDERED_FORMATS = [
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
  LevelFormat.LOWER_ROMAN,
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
];

function orderedLevels() {
  return ORDERED_FORMATS.map((format, level) => ({
    level,
    format,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: INDENT_STEP * (level + 1), hanging: 360 } } },
  }));
}

export interface DocxInput {
  title: string;
  sections: string[];
  pageSize: PageSize;
}

/** Renders the title and Markdown sections into a Word file in the built-in house style. */
export async function renderDocx({ title, sections, pageSize }: DocxInput): Promise<Buffer> {
  let instance = 0;
  const ctx: Context = { listLevel: 0, quote: false, nextInstance: () => ++instance };
  const body = sections.flatMap((section) =>
    parseMarkdown(section).flatMap((block) => renderBlock(block, ctx)),
  );
  const heading = (size: number) => ({
    run: { font: THEME.headingFont, size, bold: true, color: THEME.headingColor },
    paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
  });

  const document = new Document({
    title,
    creator: 'BennyChat',
    styles: {
      default: {
        document: {
          run: { font: THEME.bodyFont, size: 22, color: THEME.textColor },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        title: {
          run: { font: THEME.headingFont, size: 48, bold: true, color: THEME.headingColor },
          paragraph: { spacing: { after: 240 } },
        },
        heading1: heading(32),
        heading2: heading(28),
        heading3: heading(24),
        heading4: heading(22),
        heading5: heading(22),
        heading6: heading(22),
        hyperlink: { run: { color: THEME.linkColor, underline: {} } },
      },
    },
    numbering: { config: [{ reference: ORDERED, levels: orderedLevels() }] },
    sections: [
      {
        properties: {
          page: {
            size: PAGE_SIZES[pageSize],
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    color: THEME.mutedColor,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
          ...body,
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}
