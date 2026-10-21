import { atom } from 'jotai';
import { createStorageAtom } from '~/store/jotai-utils';

/** Whether the project panel shows beside a project's chats on wide screens. */
export const projectPanelOpenAtom = createStorageAtom<boolean>('projectPanelOpen', true);

/** The panel as a drawer over the chat on narrow screens; never restored on load. */
export const projectPanelSheetAtom = atom(false);

/** Wide enough to keep the panel beside the chat instead of over it. */
export const PROJECT_PANEL_WIDE_QUERY = '(min-width: 1024px)';
