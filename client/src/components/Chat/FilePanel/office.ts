import JSZip from 'jszip';
import { init as initPptxPreview } from 'pptx-preview';
import { renderAsync as renderDocxAsync } from 'docx-preview';

export interface SlideOutline {
  number: number;
  title: string;
  lines: string[];
}

const CONTENT_TYPES = '[Content_Types].xml';
const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

/**
 * Drops `[Content_Types].xml` overrides whose part is missing from the zip. pptxgenjs writes one
 * slide master override per slide but only ships the first master, and pptx-preview aborts the
 * whole load on the first part it cannot open, so its decks would preview as an empty frame.
 * PowerPoint ignores such overrides, so removing them changes nothing for a valid file.
 */
export async function dropMissingParts(zip: JSZip): Promise<number> {
  const entry = zip.file(CONTENT_TYPES);
  if (!entry) {
    return 0;
  }
  const doc = parseXml(await entry.async('text'));
  const dangling = Array.from(doc.getElementsByTagName('Override')).filter((override) => {
    const part = (override.getAttribute('PartName') ?? '').replace(/^\//, '');
    return part !== '' && zip.file(part) == null;
  });
  if (dangling.length === 0) {
    return 0;
  }
  dangling.forEach((override) => override.parentNode?.removeChild(override));
  zip.file(CONTENT_TYPES, new XMLSerializer().serializeToString(doc));
  return dangling.length;
}

function paragraphText(paragraph: Element): string {
  return Array.from(paragraph.getElementsByTagNameNS(DRAWING_NS, 't'))
    .map((run) => run.textContent ?? '')
    .join('')
    .trim();
}

function isTitleShape(shape: Element): boolean {
  const placeholder = shape.getElementsByTagNameNS(PRESENTATION_NS, 'ph')[0];
  return placeholder != null && TITLE_PLACEHOLDERS.has(placeholder.getAttribute('type') ?? '');
}

function outlineSlide(number: number, xml: string): SlideOutline {
  const shapes = Array.from(parseXml(xml).getElementsByTagNameNS(PRESENTATION_NS, 'sp'));
  const titleShape = shapes.find(isTitleShape);
  const textOf = (shape: Element) =>
    Array.from(shape.getElementsByTagNameNS(DRAWING_NS, 'p'))
      .map(paragraphText)
      .filter((line) => line !== '');
  const title = titleShape ? textOf(titleShape).join(' ') : '';
  const lines = shapes.filter((shape) => shape !== titleShape).flatMap(textOf);
  if (title !== '' || lines.length === 0) {
    return { number, title, lines };
  }
  return { number, title: lines[0], lines: lines.slice(1) };
}

/** The text of every slide in order, for decks the visual renderer cannot draw. */
export async function readSlideOutline(zip: JSZip): Promise<SlideOutline[]> {
  const slides = Object.keys(zip.files)
    .map((path) => ({ path, match: SLIDE_PATH.exec(path) }))
    .filter((slide): slide is { path: string; match: RegExpExecArray } => slide.match != null)
    .map(({ path, match }) => ({ path, number: Number(match[1]) }))
    .sort((a, b) => a.number - b.number);
  return Promise.all(
    slides.map(async ({ path, number }) =>
      outlineSlide(number, (await zip.file(path)?.async('text')) ?? ''),
    ),
  );
}

/** Slide width that fits the panel, never upscaled past a readable maximum. */
export function fitSlideWidth(availableWidth: number, maxWidth = 960): number {
  return Math.max(160, Math.min(Math.floor(availableWidth), maxWidth));
}

export async function renderDocx(data: ArrayBuffer, body: HTMLElement, styles: HTMLElement) {
  await renderDocxAsync(data, body, styles, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    renderComments: false,
    renderChanges: false,
    useBase64URL: true,
  });
}

export interface PptxRender {
  slideCount: number;
  outline: SlideOutline[];
}

/**
 * Draws every slide into `container`, one under the other. Returns the outline too, so the caller
 * can fall back to it when the renderer produced no slides (it reports failures by rendering
 * nothing rather than throwing).
 */
export async function renderPptx(
  data: ArrayBuffer,
  container: HTMLElement,
  availableWidth: number,
): Promise<PptxRender> {
  const zip = await JSZip.loadAsync(data);
  const [outline] = await Promise.all([readSlideOutline(zip), dropMissingParts(zip)]);
  const repaired = await zip.generateAsync({ type: 'arraybuffer' });
  /** Without a height the renderer sizes each slide from the deck's own aspect ratio and lets the list grow. */
  const previewer = initPptxPreview(container, {
    mode: 'list',
    width: fitSlideWidth(availableWidth),
  });
  try {
    await previewer.preview(repaired);
  } catch {
    return { slideCount: 0, outline };
  }
  return { slideCount: previewer.slideCount, outline };
}
