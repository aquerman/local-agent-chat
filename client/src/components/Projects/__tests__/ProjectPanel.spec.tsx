import { RecoilRoot } from 'recoil';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { TChatProject, TConversation, TProjectThread } from 'librechat-data-provider';
import ProjectPanel, { buildPanelRows } from '../Panel/ProjectPanel';

const mockNavigateToConvo = jest.fn();
const mockNewConversation = jest.fn();
const mockData: {
  project?: TChatProject;
  threads: TProjectThread[];
  conversations: TConversation[];
  activeJobIds: string[];
} = { threads: [], conversations: [], activeJobIds: [] };

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNavigateToConvo: () => ({ navigateToConvo: mockNavigateToConvo }),
  useNewConvo: () => ({ newConversation: mockNewConversation }),
}));

jest.mock('~/data-provider', () => ({
  useProjectQuery: () => ({ data: mockData.project }),
  useProjectThreadsQuery: () => ({ data: { threads: mockData.threads }, isLoading: false }),
  useConversationsInfiniteQuery: () => ({
    data: { pages: [{ conversations: mockData.conversations, nextCursor: null }] },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
  }),
  useActiveJobs: () => ({ data: { activeJobIds: mockData.activeJobIds } }),
}));

const projectId = '6650f0c2a1b2c3d4e5f60718';

const project: TChatProject = {
  _id: projectId,
  name: 'Trip',
  conversationCount: 3,
  coordinatorConversationId: 'coord',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
};

const convo = (conversationId: string, title: string, updatedAt: string): TConversation =>
  ({
    conversationId,
    title,
    chatProjectId: projectId,
    endpoint: 'agents',
    createdAt: updatedAt,
    updatedAt,
  }) as TConversation;

const thread = (overrides: Partial<TProjectThread>): TProjectThread => ({
  id: 't1',
  projectId,
  conversationId: 'c1',
  title: 'Lisbon flights',
  status: 'done',
  summary: 'TAP at **79 EUR**.',
  createdAt: '2026-10-21T08:00:00.000Z',
  updatedAt: '2026-10-21T08:00:00.000Z',
  ...overrides,
});

describe('buildPanelRows', () => {
  it('leaves out the project chat and joins thread status and summary onto chats', () => {
    const rows = buildPanelRows(
      [
        convo('coord', 'Planning', '2026-10-21T09:00:00.000Z'),
        convo('c1', 'Lisbon flights', '2026-10-21T08:30:00.000Z'),
        convo('c2', 'Packing list', '2026-10-21T07:00:00.000Z'),
      ],
      [thread({})],
      'coord',
    );
    expect(rows.map((row) => row.conversationId)).toEqual(['c1', 'c2']);
    expect(rows[0]).toMatchObject({ status: 'done', detail: 'TAP at 79 EUR.' });
    expect(rows[1].status).toBeUndefined();
  });

  it('keeps a thread whose chat is not loaded yet, newest first', () => {
    const rows = buildPanelRows(
      [convo('c2', 'Packing list', '2026-10-21T07:00:00.000Z')],
      [
        thread({
          id: 't9',
          conversationId: 'c9',
          title: 'Hotels',
          status: 'working',
          summary: undefined,
          updatedAt: '2026-10-21T10:00:00.000Z',
        }),
      ],
      'coord',
    );
    expect(rows.map((row) => row.conversationId)).toEqual(['c9', 'c2']);
    expect(rows[0].conversation).toBeUndefined();
  });
});

function renderPanel(conversationId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/c/${conversationId}`]}>
          <Routes>
            <Route
              path="/c/:conversationId"
              element={
                <ProjectPanel
                  projectId={projectId}
                  conversationId={conversationId}
                  isSubmitting={false}
                  onClose={jest.fn()}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

describe('ProjectPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockData.project = project;
    mockData.threads = [
      thread({}),
      thread({
        id: 't2',
        conversationId: 'c3',
        title: 'Hotels',
        status: 'working',
        summary: undefined,
        updatedAt: '2026-10-21T11:00:00.000Z',
      }),
    ];
    mockData.conversations = [
      convo('coord', 'Planning', '2026-10-21T09:00:00.000Z'),
      convo('c1', 'Lisbon flights', '2026-10-21T08:30:00.000Z'),
    ];
    mockData.activeJobIds = [];
  });

  it('marks the project chat and lists threads with status, summary and a queued one', () => {
    renderPanel('coord');
    const projectChat = screen.getByRole('button', { name: /com_ui_project_chat/ });
    expect(projectChat).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Planning')).toBeNull();

    const lisbon = screen.getByRole('button', { name: /Lisbon flights/ });
    expect(within(lisbon).getByTestId('thread-status-done')).toBeInTheDocument();
    expect(within(lisbon).getByText('TAP at 79 EUR.')).toBeInTheDocument();

    const hotels = screen.getByRole('button', { name: /Hotels/ });
    expect(hotels).toBeDisabled();
    expect(within(hotels).getByTestId('thread-status-working')).toBeInTheDocument();
  });

  it('opens a thread as a chat to talk to', () => {
    renderPanel('coord');
    fireEvent.click(screen.getByRole('button', { name: /Lisbon flights/ }));
    expect(mockNavigateToConvo).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1' }),
    );
  });

  it('marks the open thread instead of the project chat', () => {
    renderPanel('c1');
    expect(screen.getByRole('button', { name: /Lisbon flights/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: /com_ui_project_chat/ })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
