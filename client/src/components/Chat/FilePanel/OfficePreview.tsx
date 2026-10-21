import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficePanelKind } from './kind';
import type { SlideOutline } from './office';
import { renderDocx, renderPptx } from './office';
import { useLocalize } from '~/hooks';
import { logger } from '~/utils';

type RenderState = 'rendering' | 'ready' | 'outline' | 'error';

interface OfficePreviewProps {
  blob: Blob;
  kind: OfficePanelKind;
  title: string;
}

const FRAME_PADDING = 16;

/**
 * The frame only frames the rendered pages: the paper keeps the document's own colors in both
 * themes, like the PDF viewer, and the backdrop takes the panel's background at render time.
 */
const FRAME_STYLE = `
html, body { margin: 0; padding: 0; background: transparent; }
body { padding: ${FRAME_PADDING}px; box-sizing: border-box; }
#render { width: max-content; margin: 0 auto; }
.docx-wrapper { background: transparent !important; padding: 0 !important; align-items: center; }
.docx-wrapper > section.docx { margin: 0 auto 16px !important; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25); }
.pptx-preview-wrapper { background: transparent !important; }
.pptx-preview-slide-wrapper { margin: 0 auto 16px !important; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25); }
`;

const FRAME_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_STYLE}</style></head><body><div id="styles"></div><div id="render"></div></body></html>`;

const EXTERNAL_LINK = /^(https?:|mailto:)/i;

/**
 * Links inside a rendered document must never navigate the frame or run anything. In-document
 * bookmarks (`#…`) keep working; web and mail links open in a new tab, the rest do nothing.
 */
const guardedDocuments = new WeakSet<Document>();

function guardLinks(doc: Document) {
  if (guardedDocuments.has(doc)) {
    return;
  }
  guardedDocuments.add(doc);
  doc.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a[href]');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      return;
    }
    event.preventDefault();
    if (EXTERNAL_LINK.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  });
}

/**
 * Scales the rendered pages down to the frame's width, like a PDF viewer's "fit width", without
 * re-rendering. A page wider than the panel would otherwise be cut off on both sides.
 */
function fitToWidth(doc: Document, root: HTMLElement, naturalWidth: number) {
  const available = doc.documentElement.clientWidth - FRAME_PADDING * 2;
  const scale = naturalWidth > available && available > 0 ? available / naturalWidth : 1;
  root.style.zoom = String(scale);
}

/**
 * Renders a DOCX or PPTX in the browser from the original file, with no server converter and no
 * network access, inside a script-less sandboxed frame. The parent document draws into the frame
 * (`allow-same-origin` without `allow-scripts`), so nothing in the file can execute.
 */
export default function OfficePreview({ blob, kind, title }: OfficePreviewProps) {
  const localize = useLocalize();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);
  const [state, setState] = useState<RenderState>('rendering');
  const [outline, setOutline] = useState<SlideOutline[]>([]);

  const handleLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument ?? null;
    if (doc) {
      guardLinks(doc);
    }
    setFrameDoc(doc);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const root = frameDoc?.getElementById('render');
    if (!frame || !frameDoc || !root) {
      return;
    }
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    setState('rendering');
    root.replaceChildren();
    root.style.zoom = '1';
    const host = frame.parentElement;
    frameDoc.body.style.background = host ? getComputedStyle(host).backgroundColor : '';

    const render = async () => {
      const data = await blob.arrayBuffer();
      if (kind === 'docx') {
        /** Not the frame's head: the renderer empties its style container, which would drop ours. */
        await renderDocx(data, root, frameDoc.getElementById('styles') ?? frameDoc.head);
        return 'ready' as const;
      }
      const available = frameDoc.documentElement.clientWidth - FRAME_PADDING * 2;
      const result = await renderPptx(data, root, available);
      if (cancelled) {
        return 'ready' as const;
      }
      setOutline(result.outline);
      return result.slideCount > 0 && root.querySelector('.pptx-preview-slide-wrapper') != null
        ? ('ready' as const)
        : ('outline' as const);
    };

    render()
      .then((next) => {
        if (cancelled) {
          return;
        }
        setState(next);
        const naturalWidth = root.offsetWidth;
        fitToWidth(frameDoc, root, naturalWidth);
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => fitToWidth(frameDoc, root, naturalWidth));
          observer.observe(frame);
        }
      })
      .catch((error: unknown) => {
        logger.error('[FilePanel] Office preview failed:', error);
        if (!cancelled) {
          setState('error');
        }
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [blob, frameDoc, kind]);

  return (
    <div className="relative h-full w-full self-stretch">
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-same-origin"
        srcDoc={FRAME_DOCUMENT}
        onLoad={handleLoad}
        className="h-full w-full border-0"
        hidden={state === 'outline' || state === 'error'}
        data-testid="office-preview-frame"
      />
      {state === 'rendering' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="shimmer text-sm text-text-secondary" role="status">
            {localize('com_ui_loading')}
          </span>
        </div>
      )}
      {state === 'error' && (
        <div className="flex h-full items-center justify-center">
          <span className="text-sm text-text-secondary" role="alert">
            {localize('com_ui_preview_failed')}
          </span>
        </div>
      )}
      {state === 'outline' && <SlideOutlineList slides={outline} />}
    </div>
  );
}

function SlideOutlineList({ slides }: { slides: SlideOutline[] }) {
  const localize = useLocalize();
  return (
    <div className="h-full overflow-auto p-4">
      <p className="mb-3 text-xs text-text-secondary">{localize('com_ui_slides_text_only')}</p>
      {slides.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_ui_slides_empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {slides.map((slide) => (
            <li
              key={slide.number}
              className="rounded-lg border border-border-light bg-surface-secondary p-4"
            >
              <span className="text-xs text-text-secondary">
                {localize('com_ui_slide_n', { 0: String(slide.number) })}
              </span>
              {slide.title !== '' && <h3 className="mt-1 text-base font-medium">{slide.title}</h3>}
              {slide.lines.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {slide.lines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
