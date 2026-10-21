import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { QueryKeys, ReasoningEffort } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent, EModelEndpoint, TConversation } from 'librechat-data-provider';
import { AgentsMapContext } from '~/Providers/AgentsMapContext';
import ThinkingModeMenu from '../ThinkingModeMenu';

const endpointsConfig = {
  Benner: { type: 'custom', customParams: { reasoningFormat: 'llama_cpp_budget' } },
  OtherCustom: { type: 'custom', customParams: {} },
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: endpointsConfig }),
  useGetAgentByIdQuery: () => ({ data: undefined }),
}));

/** Saved agents as the agents map lists them, one per provider. */
const agentsMap = {
  agent_benny: { id: 'agent_benny', provider: 'Benner', model: 'local', model_parameters: {} },
  agent_other: { id: 'agent_other', provider: 'OtherCustom', model: 'x', model_parameters: {} },
} as unknown as Record<string, Agent>;

type Update = (current: Partial<TConversation> | null) => Partial<TConversation> | null;

/** Custom endpoint names are free-form strings at runtime; the conversation
 *  type narrows `endpoint` to the built-in names, hence the cast. */
const convo = (
  conversationId: string,
  endpoint: string,
  reasoning_effort?: ReasoningEffort,
): Partial<TConversation> => ({
  conversationId,
  endpoint: endpoint as EModelEndpoint,
  ...(reasoning_effort != null && { reasoning_effort }),
});

describe('ThinkingModeMenu', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
  });

  /** A fresh jotai store per render, so the remembered pick is read from
   *  localStorage the way a new page load would read it. */
  const renderMenu = ({
    conversation,
    setConversation,
  }: {
    conversation: Partial<TConversation>;
    setConversation: jest.Mock;
  }) => {
    queryClient = new QueryClient();
    return render(
      <JotaiProvider store={createStore()}>
        <QueryClientProvider client={queryClient}>
          <AgentsMapContext.Provider value={agentsMap}>
            <ThinkingModeMenu
              conversation={conversation as TConversation}
              setConversation={setConversation}
              disabled={false}
            />
          </AgentsMapContext.Provider>
        </QueryClientProvider>
      </JotaiProvider>,
    );
  };

  it('is hidden for an endpoint without llama_cpp_budget and seeds nothing', () => {
    const setConversation = jest.fn();
    renderMenu({
      conversation: convo('c1', 'OtherCustom'),
      setConversation,
    });
    expect(screen.queryByTestId('thinking-mode')).not.toBeInTheDocument();
    expect(setConversation).not.toHaveBeenCalled();
  });

  it('seeds a new Benner conversation with Low when nothing was picked before', () => {
    const setConversation = jest.fn();
    renderMenu({ conversation: convo('new', 'Benner'), setConversation });
    const update: Update = setConversation.mock.calls[0][0];
    expect(update(convo('new', 'Benner'))).toMatchObject({
      reasoning_effort: 'low',
    });
    expect(screen.getByTestId('thinking-mode')).toHaveTextContent('com_ui_thinking_mode_low');
  });

  it('seeds from the last pick in this browser', () => {
    localStorage.setItem('lastThinkingMode', JSON.stringify('high'));
    const setConversation = jest.fn();
    renderMenu({ conversation: convo('new', 'Benner'), setConversation });
    /** The last call: jotai re-reads storage when the atom mounts, so the seed
     *  settles on the saved pick after the first render. */
    const update: Update = setConversation.mock.calls.at(-1)[0];
    expect(update(convo('new', 'Benner'))).toMatchObject({ reasoning_effort: 'high' });
    expect(screen.getByTestId('thinking-mode')).toHaveTextContent('com_ui_thinking_mode_high');
  });

  it('shows the stored mode and does not reseed it', () => {
    const setConversation = jest.fn();
    renderMenu({
      conversation: convo('c2', 'Benner', ReasoningEffort.medium),
      setConversation,
    });
    expect(screen.getByTestId('thinking-mode')).toHaveTextContent('com_ui_thinking_mode_medium');
    expect(setConversation).not.toHaveBeenCalled();
  });

  it('reads a stored max effort as High without rewriting it', () => {
    const setConversation = jest.fn();
    renderMenu({
      conversation: convo('c4', 'Benner', ReasoningEffort.max),
      setConversation,
    });
    expect(screen.getByTestId('thinking-mode')).toHaveTextContent('com_ui_thinking_mode_high');
    expect(setConversation).not.toHaveBeenCalled();
  });

  it('picking Off writes none, updates the cached conversation and remembers it', async () => {
    const setConversation = jest.fn();
    renderMenu({
      conversation: convo('c3', 'Benner', ReasoningEffort.low),
      setConversation,
    });
    await userEvent.click(screen.getByTestId('thinking-mode'));
    await userEvent.click(await screen.findByText('com_ui_thinking_mode_none'));
    const update: Update = setConversation.mock.calls.at(-1)[0];
    expect(update(convo('c3', 'Benner', ReasoningEffort.low))).toMatchObject({
      reasoning_effort: 'none',
    });
    expect(JSON.parse(localStorage.getItem('lastThinkingMode') ?? 'null')).toBe('none');
    expect(
      queryClient.getQueryData<TConversation>([QueryKeys.conversation, 'c3'])?.reasoning_effort,
    ).toBe('none');
  });

  it('follows a saved agent to its llama_cpp_budget provider and seeds its conversation', () => {
    const setConversation = jest.fn();
    const agentConvo = { ...convo('a1', 'agents'), agent_id: 'agent_benny' };
    renderMenu({ conversation: agentConvo, setConversation });
    expect(screen.getByTestId('thinking-mode')).toHaveTextContent('com_ui_thinking_mode_low');
    const update: Update = setConversation.mock.calls[0][0];
    expect(update(agentConvo)).toMatchObject({ agent_id: 'agent_benny', reasoning_effort: 'low' });
  });

  it('stays hidden for a saved agent on any other provider', () => {
    const setConversation = jest.fn();
    renderMenu({
      conversation: { ...convo('a2', 'agents'), agent_id: 'agent_other' },
      setConversation,
    });
    expect(screen.queryByTestId('thinking-mode')).not.toBeInTheDocument();
    expect(setConversation).not.toHaveBeenCalled();
  });
});
