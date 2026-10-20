/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { RecoilRoot } from 'recoil';
import { fireEvent, render, screen } from '@testing-library/react';
import { getFilePanelKind } from '../kind';
import FilePanel from '../FilePanel';

const mockPreview = jest.fn();

jest.mock('~/data-provider', () => ({
  useFilePreviewBlob: () => ({ refetch: mockPreview }),
  useFileDownload: () => ({ refetch: jest.fn() }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock(
  '~/components/Chat/Messages/Content/FilePreviewDialog',
  () =>
    ({ open }: { open: boolean }) =>
      open ? <div>extracted text dialog</div> : null,
);

beforeAll(() => {
  URL.createObjectURL = jest.fn(() => 'blob:preview');
  URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  mockPreview.mockReset();
});

describe('getFilePanelKind', () => {
  it('routes PDFs and images to the panel and leaves other documents to the dialog', () => {
    expect(getFilePanelKind({ file_id: 'a', filename: 'a.pdf', type: 'application/pdf' })).toBe(
      'pdf',
    );
    expect(getFilePanelKind({ file_id: 'b', filename: 'b.PNG' })).toBe('image');
    expect(getFilePanelKind({ file_id: 'c', filename: 'c.docx', type: 'application/msword' })).toBe(
      null,
    );
    expect(getFilePanelKind({ filename: 'd.pdf' })).toBe(null);
  });
});

describe('FilePanel', () => {
  const renderPanel = (props: Partial<React.ComponentProps<typeof FilePanel>> = {}) =>
    render(
      <RecoilRoot>
        <FilePanel
          file={{ file_id: 'pdf', filename: 'report.pdf', type: 'application/pdf' }}
          kind="pdf"
          onClose={jest.fn()}
          {...props}
        />
      </RecoilRoot>,
    );

  it('renders the original PDF in a frame', async () => {
    mockPreview.mockResolvedValue({ data: new Blob(['%PDF']) });
    renderPanel();
    expect(screen.getByRole('status')).toBeInTheDocument();
    const frame = await screen.findByTitle('com_ui_preview: report.pdf');
    expect(frame).toHaveAttribute('src', 'blob:preview');
  });

  it('renders images as an image', async () => {
    mockPreview.mockResolvedValue({ data: new Blob(['png'], { type: 'image/png' }) });
    renderPanel({
      file: { file_id: 'img', filename: 'photo.png', type: 'image/png' },
      kind: 'image',
    });
    expect(await screen.findByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      'blob:preview',
    );
  });

  it('reports a failed download instead of spinning', async () => {
    mockPreview.mockResolvedValue({ data: undefined });
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_preview_failed');
  });

  it('offers the extracted text only for files the model read as text, and closes', async () => {
    mockPreview.mockResolvedValue({ data: new Blob(['%PDF']) });
    const onClose = jest.fn();
    renderPanel({
      file: {
        file_id: 'pdf',
        filename: 'report.pdf',
        type: 'application/pdf',
        llmDeliveryPath: 'text',
      },
      onClose,
    });
    await screen.findByTitle('com_ui_preview: report.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_view_extracted_text' }));
    expect(screen.getByText('extracted text dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
