import { memo, useEffect, useRef } from 'react';
import type { TAttachment, TAttachmentMetadata, TFile } from 'librechat-data-provider';
import type { FilePanelContextValue } from '~/components/Chat/FilePanel/context';
import type { OfficePanelKind } from '~/components/Chat/FilePanel/kind';
import { artifactRowKind, TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import { getOfficePanelKind } from '~/components/Chat/FilePanel/kind';
import { displayFilename } from './attachmentTypes';
import { useAttachmentLink } from './LogLink';
import ArtifactRow from './ArtifactRow';

const ROW_KINDS = {
  docx: artifactRowKind({ type: TOOL_ARTIFACT_TYPES.DOCX }),
  pptx: artifactRowKind({ type: TOOL_ARTIFACT_TYPES.PRESENTATION }),
} satisfies Record<OfficePanelKind, ReturnType<typeof artifactRowKind>>;

/** A tool-made DOCX or PPTX the chat's file panel can preview from the original file. */
export function getOfficeRowKind(
  attachment: TAttachment,
  filePanel: FilePanelContextValue | null,
): OfficePanelKind | null {
  const file = attachment as Partial<TFile>;
  if (filePanel == null || !file.file_id || !file.filepath) {
    return null;
  }
  return getOfficePanelKind(file);
}

interface OfficeFileRowProps {
  attachment: TAttachment;
  kind: OfficePanelKind;
  filePanel: FilePanelContextValue;
}

/**
 * Same row as every other artifact, but it opens the file panel, which renders the DOCX/PPTX in
 * the browser. The Sandpack artifact view it replaces needs a bundler and a CDN script, so it stays
 * blank offline.
 */
const OfficeFileRow = memo(({ attachment, kind, filePanel }: OfficeFileRowProps) => {
  const file = attachment as TFile & TAttachmentMetadata;
  const { openFile, closeFile, openFileId } = filePanel;
  const isOpen = openFileId != null && openFileId === file.file_id;
  const { handleDownload } = useAttachmentLink({
    href: attachment.filepath ?? '',
    filename: attachment.filename ?? '',
    file_id: file.file_id,
    user: file.user,
    source: file.source,
  });

  /** A tool that rewrites the file in place sends a new attachment for the same id; reload the open preview. */
  const shownRef = useRef(attachment);
  useEffect(() => {
    if (shownRef.current === attachment) {
      return;
    }
    shownRef.current = attachment;
    if (isOpen) {
      openFile(attachment as Partial<TFile>);
    }
  }, [attachment, isOpen, openFile]);

  const handleOpen = () => {
    if (isOpen) {
      closeFile();
      return;
    }
    openFile(attachment as Partial<TFile>);
  };

  return (
    <ArtifactRow
      title={displayFilename(attachment.filename)}
      kind={ROW_KINDS[kind]}
      isSelected={isOpen}
      onOpen={handleOpen}
      onDownload={handleDownload}
      artifactId={file.file_id}
    />
  );
});
OfficeFileRow.displayName = 'OfficeFileRow';

export default OfficeFileRow;
