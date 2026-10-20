import { createContext, useContext } from 'react';
import type { TFile } from 'librechat-data-provider';

export interface FilePanelContextValue {
  /** Opens the attachment in the side panel; returns false when the panel cannot show it. */
  openFile: (file: Partial<TFile>) => boolean;
}

export const FilePanelContext = createContext<FilePanelContextValue | null>(null);

/** Null outside the chat view (shared links, search), where callers fall back to the dialog. */
export function useFilePanel(): FilePanelContextValue | null {
  return useContext(FilePanelContext);
}
