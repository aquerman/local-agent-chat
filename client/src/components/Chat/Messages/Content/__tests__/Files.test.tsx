/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import { FilePanelContext } from '~/components/Chat/FilePanel';
import Files from '../Files';

jest.mock('~/Providers', () => ({
  useFileMapContext: () => ({}),
  useShareContext: () => ({}),
}));
jest.mock(
  '~/components/Chat/Input/Files/FileContainer',
  () =>
    ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>file action</button>,
);
jest.mock('../Image', () => () => <div>image preview</div>);
jest.mock(
  '../FilePreviewDialog',
  () =>
    ({ open, deliveryPath }: { open: boolean; deliveryPath?: string }) =>
      open ? <div>preview: {deliveryPath}</div> : null,
);

it('exposes extracted image text without changing ordinary image previews', () => {
  render(
    <Files
      message={
        {
          files: [
            { file_id: 'text-image', type: 'image/png', llmDeliveryPath: 'text' },
            { file_id: 'image', type: 'image/png' },
          ],
        } as TMessage
      }
    />,
  );
  expect(screen.getAllByText('image preview')).toHaveLength(1);
  fireEvent.click(screen.getByText('file action'));
  expect(screen.getByText('preview: text')).toBeInTheDocument();
});

it('opens files in the side panel when the chat view provides one', () => {
  const openFile = jest.fn(() => true);
  render(
    <FilePanelContext.Provider value={{ openFile }}>
      <Files
        message={
          {
            files: [{ file_id: 'pdf', type: 'application/pdf', llmDeliveryPath: 'text' }],
          } as TMessage
        }
      />
    </FilePanelContext.Provider>,
  );
  fireEvent.click(screen.getByText('file action'));
  expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ file_id: 'pdf' }));
  expect(screen.queryByText(/preview:/)).not.toBeInTheDocument();
});

it('falls back to the text dialog when the panel declines the file', () => {
  render(
    <FilePanelContext.Provider value={{ openFile: () => false }}>
      <Files
        message={
          {
            files: [{ file_id: 'doc', type: 'application/msword', llmDeliveryPath: 'text' }],
          } as TMessage
        }
      />
    </FilePanelContext.Provider>,
  );
  fireEvent.click(screen.getByText('file action'));
  expect(screen.getByText('preview: text')).toBeInTheDocument();
});
