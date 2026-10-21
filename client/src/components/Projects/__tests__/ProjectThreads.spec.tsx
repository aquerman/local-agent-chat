import { RecoilRoot } from 'recoil';
import { dataService } from 'librechat-data-provider';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TChatProject, TProjectThread } from 'librechat-data-provider';
import ThreadStatusChip from '../ThreadStatusChip';
import ProjectThreads from '../ProjectThreads';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const project: TChatProject = {
  _id: '6650f0c2a1b2c3d4e5f60718',
  name: 'Trip',
  conversationCount: 2,
  coordinatorConversationId: 'coord-1',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
};

const thread = (overrides: Partial<TProjectThread>): TProjectThread => ({
  id: 't1',
  projectId: project._id,
  conversationId: 'c1',
  title: 'Lisbon flights',
  status: 'done',
  summary: 'TAP at 79 EUR.',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  ...overrides,
});

function renderThreads(target: TChatProject = project) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/projects/p']}>
          <Routes>
            <Route path="/projects/p" element={<ProjectThreads project={target} />} />
            <Route path="/c/:id" element={<div data-testid="opened-chat" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

describe('ProjectThreads', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists threads with status and summary and opens one', async () => {
    jest.spyOn(dataService, 'getProjectThreads').mockResolvedValue({
      threads: [
        thread({}),
        thread({
          id: 't2',
          conversationId: 'c2',
          title: 'Hotels',
          status: 'needs_you',
          summary: undefined,
        }),
        thread({
          id: 't3',
          conversationId: 'c3',
          title: 'Trains',
          status: 'failed',
          summary: undefined,
          error: 'Stopped before it finished.',
        }),
      ],
    });
    renderThreads();

    expect(await screen.findByText('Lisbon flights')).toBeInTheDocument();
    expect(screen.getByText('TAP at 79 EUR.')).toBeInTheDocument();
    expect(screen.getByTestId('thread-status-done')).toHaveTextContent('com_ui_thread_status_done');
    expect(screen.getByTestId('thread-status-needs_you')).toBeInTheDocument();
    expect(screen.getByText('Stopped before it finished.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Hotels'));
    expect(await screen.findByTestId('opened-chat')).toBeInTheDocument();
  });

  it('shows the empty hint and opens the coordinator chat', async () => {
    jest.spyOn(dataService, 'getProjectThreads').mockResolvedValue({ threads: [] });
    renderThreads();
    expect(await screen.findByText('com_ui_project_threads_empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /com_ui_project_coordinator_open/ }));
    await waitFor(() => expect(screen.getByTestId('opened-chat')).toBeInTheDocument());
  });

  it('hides the coordinator button until a project has one', async () => {
    jest.spyOn(dataService, 'getProjectThreads').mockResolvedValue({ threads: [] });
    renderThreads({ ...project, coordinatorConversationId: null });
    await screen.findByText('com_ui_project_threads_empty');
    expect(screen.queryByRole('button', { name: /com_ui_project_coordinator_open/ })).toBeNull();
  });
});

describe('ThreadStatusChip', () => {
  it('renders nothing for an ordinary chat', () => {
    const { container } = render(<ThreadStatusChip status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels each status', () => {
    render(<ThreadStatusChip status="working" />);
    expect(screen.getByTestId('thread-status-working')).toHaveTextContent(
      'com_ui_thread_status_working',
    );
  });
});
