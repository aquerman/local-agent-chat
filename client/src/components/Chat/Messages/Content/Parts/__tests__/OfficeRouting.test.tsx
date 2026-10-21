import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TAttachment } from 'librechat-data-provider';
import type { MutableSnapshot } from 'recoil';
import type { FilePanelContextValue } from '~/components/Chat/FilePanel/context';
import { FilePanelContext } from '~/components/Chat/FilePanel/context';
import Attachment, { AttachmentGroup } from '../Attachment';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string): string =>
      key,
  /* `FileAttachment` calls this hook unconditionally to bridge the
   * deferred-preview lifecycle into the attachment cache. The
   * routing tests don't exercise the preview flow itself — stub it
   * to a no-op so it doesn't blow up jsdom rendering. */
  useAttachmentPreviewSync: () => ({ status: 'ready', previewError: undefined, isPolling: false }),
  useExpandCollapse: (isExpanded: boolean) => ({
    style: { display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr' },
    ref: { current: null },
  }),
}));

jest.mock('../LogLink', () => ({
  useAttachmentLink: () => ({ handleDownload: jest.fn() }),
}));

jest.mock('~/components/Chat/Input/Files/FileContainer', () => ({
  __esModule: true,
  default: ({ file, displayName }: { file: { filename?: string }; displayName?: string }) => (
    <div data-testid="file-container">{displayName ?? file.filename ?? ''}</div>
  ),
}));

jest.mock('~/components/Chat/Input/Files/FilePreview', () => ({
  __esModule: true,
  default: () => <div data-testid="file-preview" />,
}));

jest.mock('~/components/Chat/Messages/Content/Image', () => ({
  __esModule: true,
  default: ({ altText }: { altText?: string }) => <img alt={altText ?? ''} data-testid="image" />,
}));

jest.mock('~/components/Messages/Content/Mermaid/Mermaid', () => ({
  __esModule: true,
  default: ({
    children,
    artifact,
  }: {
    children: string;
    artifact?: { id: string; title?: string; type?: string };
  }) => (
    <div
      data-testid="mermaid-render"
      data-artifact-id={artifact?.id}
      data-artifact-title={artifact?.title}
      data-artifact-type={artifact?.type}
    >
      {children}
    </div>
  ),
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  getFileType: () => ({ paths: [], color: '', title: 'Artifact' }),
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  isArtifactRoute: () => false,
}));

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const officeAttachment = (overrides: Partial<TAttachment> = {}): TAttachment =>
  ({
    file_id: 'doc-1',
    filename: 'Team_Lunch_Plan.docx',
    filepath: '/files/doc-1',
    type: DOCX,
    bytes: 11192,
    status: 'pending',
    ...overrides,
  }) as TAttachment;

const panel = (overrides: Partial<FilePanelContextValue> = {}): FilePanelContextValue => ({
  openFile: jest.fn(() => true),
  closeFile: jest.fn(),
  openFileId: null,
  ...overrides,
});

const renderInChat = (ui: React.ReactElement, filePanel: FilePanelContextValue) => {
  const initializeState = (snapshot: MutableSnapshot) => {
    snapshot.set(store.isSubmittingFamily(0), true);
  };
  const view = render(
    <RecoilRoot initializeState={initializeState}>
      <FilePanelContext.Provider value={filePanel}>{ui}</FilePanelContext.Provider>
    </RecoilRoot>,
  );
  const rerenderWith = (next: React.ReactElement, nextPanel: FilePanelContextValue) =>
    view.rerender(
      <RecoilRoot initializeState={initializeState}>
        <FilePanelContext.Provider value={nextPanel}>{next}</FilePanelContext.Provider>
      </RecoilRoot>,
    );
  return { ...view, rerenderWith };
};

describe('Office files in the chat file panel', () => {
  it.each([
    ['Team_Lunch_Plan.docx', DOCX],
    [
      'Quarterly_Review.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  ])('opens %s in the file panel, even while its HTML preview is pending', (filename, type) => {
    const filePanel = panel();
    const attachment = officeAttachment({ filename, type } as Partial<TAttachment>);
    renderInChat(<AttachmentGroup attachments={[attachment]} />, filePanel);

    expect(screen.queryByText('com_ui_preview_preparing')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(filePanel.openFile).toHaveBeenCalledWith(attachment);
    expect(screen.getByRole('button', { name: `com_ui_download ${filename}` })).toBeInTheDocument();
  });

  it('closes the panel when the open file is clicked again', () => {
    const filePanel = panel({ openFileId: 'doc-1' });
    renderInChat(<Attachment attachment={officeAttachment()} />, filePanel);

    fireEvent.click(screen.getByRole('button', { expanded: true }));

    expect(filePanel.closeFile).toHaveBeenCalled();
    expect(filePanel.openFile).not.toHaveBeenCalled();
  });

  it('does not touch the artifact panel', () => {
    const onSnapshot = jest.fn();
    const Probe = () => {
      const artifacts = useRecoilValue(store.artifactsState);
      onSnapshot(Object.keys(artifacts ?? {}));
      return null;
    };
    renderInChat(
      <>
        <AttachmentGroup
          attachments={[
            officeAttachment({ status: 'ready', text: '<p>x</p>' } as Partial<TAttachment>),
          ]}
        />
        <Probe />
      </>,
      panel(),
    );
    expect(onSnapshot).toHaveBeenLastCalledWith([]);
  });

  it('reloads the open preview when the tool rewrites the file in place', () => {
    const filePanel = panel({ openFileId: 'doc-1' });
    const first = officeAttachment();
    const { rerenderWith } = renderInChat(<Attachment attachment={first} />, filePanel);
    expect(filePanel.openFile).not.toHaveBeenCalled();

    const appended = officeAttachment({ bytes: 14000 } as Partial<TAttachment>);
    rerenderWith(<Attachment attachment={appended} />, filePanel);

    expect(filePanel.openFile).toHaveBeenCalledWith(appended);
  });

  it('keeps the artifact card outside the chat view, where no file panel exists', () => {
    render(
      <RecoilRoot>
        <Attachment
          attachment={officeAttachment({
            status: 'ready',
            text: '<p>x</p>',
          } as Partial<TAttachment>)}
        />
      </RecoilRoot>,
    );
    expect(screen.getByText('Team_Lunch_Plan.docx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /com_ui_artifact_click/ })).toBeInTheDocument();
  });
});
