import { z } from 'zod';
import PptxGenJS from 'pptxgenjs';
import type { Block } from '~/markdown';
import { parseMarkdown, plainText } from '~/markdown';
import { DocumentsError } from '~/errors';
import { THEME } from '~/theme';

/** One slide of the outline the model supplies. The layout follows from which fields are set. */
export interface Slide {
  title: string;
  subtitle?: string;
  bullets?: string[];
  left?: string[];
  right?: string[];
  leftTitle?: string;
  rightTitle?: string;
  notes?: string;
}

export type SlideLayout = 'section' | 'bullets' | 'two-column';

export const slideSchema = z.object({
  title: z.string().describe('Slide title'),
  subtitle: z.string().optional().describe('Only for a section divider slide without bullets'),
  bullets: z
    .array(z.string())
    .optional()
    .describe('Bullet points; start one with two spaces to indent it under the previous'),
  left: z.array(z.string()).optional().describe('Left column bullets (makes a two-column slide)'),
  right: z.array(z.string()).optional().describe('Right column bullets'),
  leftTitle: z.string().optional(),
  rightTitle: z.string().optional(),
  notes: z.string().optional().describe('Speaker notes'),
});

const outlineSchema = z.union([z.array(slideSchema), z.object({ slides: z.array(slideSchema) })]);

export function slideLayout(slide: Slide): SlideLayout {
  if ((slide.left?.length ?? 0) > 0 || (slide.right?.length ?? 0) > 0) {
    return 'two-column';
  }
  if ((slide.bullets?.length ?? 0) === 0) {
    return 'section';
  }
  return 'bullets';
}

function parseJsonOutline(content: string): Slide[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new DocumentsError(`The slide outline is not valid JSON (${reason}).`);
  }
  const parsed = outlineSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DocumentsError(
      `The slide outline does not match [{title, bullets?, left?, right?, notes?}]: ${issue?.path.join('.')} ${issue?.message}.`,
    );
  }
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.slides;
}

function listLines(block: Extract<Block, { type: 'list' }>, depth: number): string[] {
  return block.items.flatMap((item) =>
    item.blocks.flatMap((child) =>
      child.type === 'list' ? listLines(child, depth + 1) : blockLines(child, depth),
    ),
  );
}

function blockLines(block: Block, depth: number): string[] {
  const indent = '  '.repeat(depth);
  switch (block.type) {
    case 'paragraph':
      return [`${indent}${plainText(block.inlines)}`];
    case 'list':
      return listLines(block, depth);
    case 'code':
      return block.text.split('\n').map((line) => `${indent}${line}`);
    case 'quote':
      return block.blocks.flatMap((child) => blockLines(child, depth));
    case 'table':
      return block.rows.map((row) => `${indent}${row.map(plainText).join(' | ')}`);
    default:
      return [];
  }
}

/**
 * Reads a Markdown outline: `#`/`##` starts a slide, list items and paragraphs become bullets,
 * and the first two `###` headings inside a slide open the left and right columns.
 */
function parseMarkdownOutline(content: string): Slide[] {
  const slides: Slide[] = [];
  let column: 'bullets' | 'left' | 'right' = 'bullets';
  const current = (): Slide => {
    if (slides.length === 0) {
      slides.push({ title: '' });
    }
    return slides[slides.length - 1];
  };
  for (const block of parseMarkdown(content)) {
    if (block.type === 'heading' && block.level <= 2) {
      slides.push({ title: plainText(block.inlines) });
      column = 'bullets';
      continue;
    }
    const slide = current();
    if (block.type === 'heading') {
      column = column === 'bullets' ? 'left' : 'right';
      slide[column === 'left' ? 'leftTitle' : 'rightTitle'] = plainText(block.inlines);
      continue;
    }
    const lines = blockLines(block, 0);
    if (lines.length === 0) {
      continue;
    }
    slide[column] = [...(slide[column] ?? []), ...lines];
  }
  return slides.filter((slide) => slide.title !== '' || slideLayout(slide) !== 'section');
}

/** Accepts a JSON outline (array of slides, or `{slides}`) or a Markdown outline. */
export function parseOutline(content: string): Slide[] {
  const trimmed = content.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonOutline(trimmed);
  }
  return parseMarkdownOutline(trimmed);
}

const WIDTH = 13.333;
const MARGIN = 0.6;
const BODY_TOP = 1.55;
const BODY_HEIGHT = 5.3;

type TextRuns = PptxGenJS.TextProps[];

/** Leading pairs of spaces indent a bullet; a typed `-`/`*`/`•` marker is dropped. */
function bulletRuns(lines: string[]): TextRuns {
  return lines.map((line) => {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const text = line.trim().replace(/^([-*•]|\d+[.)])\s+/, '');
    return {
      text,
      options: { bullet: true, indentLevel: Math.min(Math.floor(indent / 2), 3), breakLine: true },
    };
  });
}

function addTitle(slide: PptxGenJS.Slide, pptx: PptxGenJS, title: string): void {
  slide.addText(title, {
    x: MARGIN,
    y: 0.4,
    w: WIDTH - 2 * MARGIN,
    h: 0.9,
    fontFace: THEME.headingFont,
    fontSize: 28,
    bold: true,
    color: THEME.headingColor,
    valign: 'bottom',
    fit: 'shrink',
  });
  slide.addShape(pptx.ShapeType.line, {
    x: MARGIN,
    y: 1.35,
    w: WIDTH - 2 * MARGIN,
    h: 0,
    line: { color: THEME.accentColor, width: 1.5 },
  });
}

function addBody(
  slide: PptxGenJS.Slide,
  lines: string[],
  box: { x: number; w: number },
  heading?: string,
): void {
  const head: TextRuns =
    heading === undefined || heading === ''
      ? []
      : [{ text: heading, options: { bold: true, color: THEME.accentColor, breakLine: true } }];
  slide.addText([...head, ...bulletRuns(lines)], {
    x: box.x,
    y: BODY_TOP,
    w: box.w,
    h: BODY_HEIGHT,
    fontFace: THEME.bodyFont,
    fontSize: 20,
    color: THEME.textColor,
    valign: 'top',
    paraSpaceAfter: 6,
    fit: 'shrink',
  });
}

function addCentered(
  slide: PptxGenJS.Slide,
  title: string,
  subtitle: string | undefined,
  size: number,
): void {
  slide.addText(title, {
    x: MARGIN,
    y: 2.3,
    w: WIDTH - 2 * MARGIN,
    h: 1.6,
    fontFace: THEME.headingFont,
    fontSize: size,
    bold: true,
    color: THEME.headingColor,
    align: 'center',
    valign: 'bottom',
    fit: 'shrink',
  });
  if (subtitle !== undefined && subtitle !== '') {
    slide.addText(subtitle, {
      x: MARGIN,
      y: 4.1,
      w: WIDTH - 2 * MARGIN,
      h: 1,
      fontFace: THEME.bodyFont,
      fontSize: 20,
      color: THEME.mutedColor,
      align: 'center',
      valign: 'top',
    });
  }
}

function addSlide(pptx: PptxGenJS, spec: Slide): void {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.slideNumber = {
    x: WIDTH - 1.1,
    y: 7.0,
    w: 0.6,
    h: 0.3,
    fontSize: 10,
    color: THEME.mutedColor,
  };
  const layout = slideLayout(spec);
  if (layout === 'section') {
    addCentered(slide, spec.title, spec.subtitle, 32);
  } else {
    addTitle(slide, pptx, spec.title);
  }
  if (layout === 'bullets') {
    addBody(slide, spec.bullets ?? [], { x: MARGIN, w: WIDTH - 2 * MARGIN });
  }
  if (layout === 'two-column') {
    const columnWidth = (WIDTH - 2 * MARGIN - 0.5) / 2;
    addBody(slide, spec.left ?? [], { x: MARGIN, w: columnWidth }, spec.leftTitle);
    addBody(
      slide,
      spec.right ?? [],
      { x: MARGIN + columnWidth + 0.5, w: columnWidth },
      spec.rightTitle,
    );
  }
  if (spec.notes !== undefined && spec.notes !== '') {
    slide.addNotes(spec.notes);
  }
}

export interface PptxInput {
  title: string;
  slides: Slide[];
}

/** Renders a 16:9 deck: a title slide from `title`, then one slide per outline entry. */
export async function renderPptx({ title, slides }: PptxInput): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title;
  pptx.author = 'BennyChat';
  const cover = pptx.addSlide();
  cover.background = { color: 'FFFFFF' };
  cover.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: WIDTH,
    h: 0.25,
    fill: { color: THEME.accentColor },
    line: { color: THEME.accentColor },
  });
  addCentered(cover, title, undefined, 40);
  for (const slide of slides) {
    addSlide(pptx, slide);
  }
  const output = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(output as Uint8Array);
}
