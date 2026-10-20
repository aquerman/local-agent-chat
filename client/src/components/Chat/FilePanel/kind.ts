import type { TFile } from 'librechat-data-provider';
import { getFileExtension, getPreviewKind } from '~/components/Chat/Messages/Content/preview';

export type FilePanelKind = 'pdf' | 'image';

export type FilePanelFile = Partial<TFile> & Pick<TFile, 'file_id'>;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']);

/** Which attachments the side panel renders as the original document; everything else keeps the text dialog. */
export function getFilePanelKind(file: Partial<TFile>): FilePanelKind | null {
  if (!file.file_id) {
    return null;
  }
  const fileName = file.filename ?? '';
  if (file.type?.startsWith('image/') || IMAGE_EXTENSIONS.has(getFileExtension(fileName))) {
    return 'image';
  }
  return getPreviewKind(fileName, file.type ?? undefined, file.source) === 'pdf' ? 'pdf' : null;
}
