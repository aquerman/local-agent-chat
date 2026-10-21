import type { TFile } from 'librechat-data-provider';
import { getFileExtension, getPreviewKind } from '~/components/Chat/Messages/Content/preview';

export type FilePanelKind = 'pdf' | 'image' | 'docx' | 'pptx';

/** Kinds the panel renders in the browser from the original Office file. */
export type OfficePanelKind = Extract<FilePanelKind, 'docx' | 'pptx'>;

export type FilePanelFile = Partial<TFile> & Pick<TFile, 'file_id'>;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']);

/** Only the zipped OOXML formats: legacy `.doc` / `.ppt` binaries have no in-browser renderer. */
const OFFICE_KINDS: ReadonlyMap<string, OfficePanelKind> = new Map([
  ['docx', 'docx'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['pptx', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
]);

export function getOfficePanelKind(file: Partial<TFile>): OfficePanelKind | null {
  return (
    OFFICE_KINDS.get(getFileExtension(file.filename ?? '')) ??
    OFFICE_KINDS.get(file.type ?? '') ??
    null
  );
}

export function isOfficePanelKind(kind: FilePanelKind): kind is OfficePanelKind {
  return kind === 'docx' || kind === 'pptx';
}

/** Which attachments the side panel renders as the original document; everything else keeps the text dialog. */
export function getFilePanelKind(file: Partial<TFile>): FilePanelKind | null {
  if (!file.file_id) {
    return null;
  }
  const fileName = file.filename ?? '';
  if (file.type?.startsWith('image/') || IMAGE_EXTENSIONS.has(getFileExtension(fileName))) {
    return 'image';
  }
  const officeKind = getOfficePanelKind(file);
  if (officeKind != null) {
    return officeKind;
  }
  return getPreviewKind(fileName, file.type ?? undefined, file.source) === 'pdf' ? 'pdf' : null;
}
