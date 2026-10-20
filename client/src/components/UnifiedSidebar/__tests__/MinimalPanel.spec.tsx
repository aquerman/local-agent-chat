import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom/extend-expect';
import { MemoryRouter } from 'react-router-dom';
import { Bot, Brain, MessagesSquare, NotebookPen } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import type { NavLink } from '~/common';
import { ActivePanelProvider, DEFAULT_PANEL } from '~/Providers';

const mockNewConversation = jest.fn();
const mockClearMessagesCache = jest.fn();

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  let counter = 0;
  const switchAtom = atom({
    key: 'mock-newChatSwitchToHistory',
    default: true,
  });
  const customShortcutsAtom = atom({
    key: 'mock-customShortcuts',
    default: {},
  });
  const shortcutsEnabledAtom = atom({
    key: 'mock-shortcutsEnabled',
    default: true,
  });
  return {
    __esModule: true,
    default: {
      conversationByIndex: () =>
        atom({ key: `mock-conversationByIndex-${counter++}`, default: null }),
      conversationIdByIndex: () =>
        atom({ key: `mock-conversationIdByIndex-${counter++}`, default: null }),
      newChatSwitchToHistory: switchAtom,
      customShortcuts: customShortcutsAtom,
      shortcutsEnabled: shortcutsEnabledAtom,
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNewConvo: () => ({ newConversation: mockNewConversation }),
  useShowMarketplace: () => false,
}));

/**
 * Stands in for the real hook, which reaches `useNewConvo` by deep path and so
 * escapes the `~/hooks` mock above. Mirrors its contract closely enough that
 * the panel-switch assertions still exercise the `onNewChat` wiring.
 */
jest.mock('~/hooks/Chat/useNewChat', () => ({
  __esModule: true,
  default: ({ onNewChat }: { onNewChat?: () => void } = {}) => ({
    newConversation: mockNewConversation,
    startNewChat: () => {
      mockNewConversation();
      onNewChat?.();
    },
    handleNewChatClick: (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      mockClearMessagesCache();
      mockNewConversation();
      onNewChat?.();
    },
  }),
}));

jest.mock('~/utils', () => ({
  clearMessagesCache: (...args: unknown[]) => mockClearMessagesCache(...args),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  CLOSE_SIDEBAR_ID: 'close-sidebar',
}));

jest.mock('~/components/Nav/AccountSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="account-settings" />,
}));

import MinimalPanel from '../MinimalPanel';

const links: NavLink[] = [
  { title: 'com_ui_chat_history' as const, icon: MessagesSquare, id: DEFAULT_PANEL },
  { title: 'com_sidepanel_agent_builder' as const, icon: Bot, id: 'agents' },
  { title: 'com_ui_prompts' as const, icon: NotebookPen, id: 'prompts' },
  { title: 'com_ui_memories' as const, icon: Brain, id: 'memories' },
];

function renderPanel({ onCollapse = jest.fn() }: { onCollapse?: jest.Mock } = {}) {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RecoilRoot>
          <ActivePanelProvider>
            <MinimalPanel links={links} onCollapse={onCollapse} onLeaveInsights={jest.fn()}>
              <div data-testid="panel-content" />
            </MinimalPanel>
          </ActivePanelProvider>
        </RecoilRoot>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onCollapse };
}

describe('MinimalPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('shows chats and agents as rows and keeps the other panels out of the sidebar', async () => {
    renderPanel();
    expect(screen.getByTestId('minimal-nav-conversations')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('minimal-nav-agents')).toBeInTheDocument();
    expect(screen.getByTestId('minimal-nav-customize')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_prompts')).not.toBeInTheDocument();
    expect(screen.getByTestId('panel-content')).toBeInTheDocument();
    expect(await screen.findByTestId('account-settings')).toBeInTheDocument();
  });

  it('opens a panel from the Customize menu', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('minimal-nav-customize'));
    fireEvent.click(await screen.findByText('com_ui_prompts'));
    await waitFor(() => expect(localStorage.getItem('side:active-panel')).toBe('prompts'));
    expect(screen.getByTestId('minimal-nav-conversations')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches back to the chats list from its row', () => {
    localStorage.setItem('side:active-panel', 'prompts');
    renderPanel();
    fireEvent.click(screen.getByTestId('minimal-nav-conversations'));
    expect(localStorage.getItem('side:active-panel')).toBe(DEFAULT_PANEL);
  });

  it('starts a new chat and collapses from the toggle', () => {
    const { onCollapse } = renderPanel();
    fireEvent.click(screen.getByTestId('new-chat-button'), { button: 0 });
    expect(mockNewConversation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('close-sidebar-button'));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
