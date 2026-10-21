import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import OfficePreview from '../OfficePreview';
import * as office from '../office';

jest.mock('pptx-preview', () => ({ init: jest.fn() }));
jest.mock('docx-preview', () => ({ renderAsync: jest.fn() }));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(' ')}` : key,
}));

const deck = new Blob(['PK-deck']);

beforeAll(() => {
  /** jsdom's Blob has no `arrayBuffer`; browsers do. */
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

const loadFrame = () => {
  const frame = screen.getByTestId('office-preview-frame') as HTMLIFrameElement;
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(
    '<!doctype html><html><head></head><body><div id="styles"></div><div id="render"></div></body></html>',
  );
  doc.close();
  frame.dispatchEvent(new Event('load'));
  return doc;
};

describe('OfficePreview', () => {
  it('draws a document into the sandboxed frame', async () => {
    const renderDocx = jest.spyOn(office, 'renderDocx').mockImplementation(async (_data, body) => {
      body.innerHTML = '<section class="docx">Agenda</section>';
    });
    render(<OfficePreview blob={new Blob(['PK-docx'])} kind="docx" title="Preview: a.docx" />);

    const frame = screen.getByTitle('Preview: a.docx');
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    const doc = loadFrame();

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(renderDocx).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      doc.getElementById('render'),
      doc.getElementById('styles'),
    );
    expect(doc.body.textContent).toBe('Agenda');
  });

  it('falls back to the slide text when no slide could be drawn', async () => {
    jest.spyOn(office, 'renderPptx').mockResolvedValue({
      slideCount: 0,
      outline: [{ number: 1, title: 'Quarterly Review', lines: ['Revenue up'] }],
    });
    render(<OfficePreview blob={deck} kind="pptx" title="Preview: deck.pptx" />);
    loadFrame();

    expect(await screen.findByText('com_ui_slides_text_only')).toBeInTheDocument();
    expect(screen.getByText('com_ui_slide_n 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quarterly Review' })).toBeInTheDocument();
    expect(screen.getByText('Revenue up')).toBeInTheDocument();
    expect(screen.getByTestId('office-preview-frame')).not.toBeVisible();
  });

  it('reports a file the renderer rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(office, 'renderDocx').mockRejectedValue(new Error('not a zip'));
    render(<OfficePreview blob={new Blob(['nope'])} kind="docx" title="Preview: bad.docx" />);
    loadFrame();

    expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_preview_failed');
  });

  it('opens web links in a new tab instead of navigating the frame', async () => {
    jest.spyOn(office, 'renderDocx').mockImplementation(async (_data, body) => {
      body.innerHTML =
        '<a id="web" href="https://example.com/">site</a><a id="js" href="javascript:alert(1)">x</a>';
    });
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(<OfficePreview blob={new Blob(['PK'])} kind="docx" title="Preview: links.docx" />);
    const doc = loadFrame();
    await waitFor(() => expect(doc.getElementById('web')).not.toBeNull());

    const web = new MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('web')!.dispatchEvent(web);
    const script = new MouseEvent('click', { bubbles: true, cancelable: true });
    doc.getElementById('js')!.dispatchEvent(script);

    expect(web.defaultPrevented).toBe(true);
    expect(script.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
  });
});
