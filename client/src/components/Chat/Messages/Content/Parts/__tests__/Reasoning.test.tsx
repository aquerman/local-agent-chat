import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { MessageContext } from '~/Providers/MessageContext';
import Reasoning, { ReasoningCompact } from '../Reasoning';
import { showThinkingAtom } from '~/store/showThinking';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
  useExpandCollapse: (isExpanded: boolean) => ({
    style: { display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr' },
    ref: { current: null },
  }),
  useLazyCollapseBody: (isExpanded: boolean) => ({
    shouldRenderBody: isExpanded,
    mountBody: jest.fn(),
    handleTransitionEnd: jest.fn(),
  }),
}));

jest.mock('~/hooks/Messages/useSmoothStreaming', () => ({
  __esModule: true,
  default: () => false,
}));

jest.mock('../Thinking', () => ({
  ThinkingContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ThinkingButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
  ThinkingLabel: ({ label }: { label: string }) => <span>{label}</span>,
  FloatingThinkingBar: () => null,
  useInViewport: () => ({ ref: { current: null }, inViewport: true }),
}));

jest.mock('~/components/Messages/Content/CopyButton', () => ({
  __esModule: true,
  default: () => <button type="button">{'copy'}</button>,
}));

let partIndex = 0;

/** Renders inside the real MessageContext so finishing a stream is a context
 *  change, exactly as in the app; `Reasoning` is memoised and would not
 *  re-render from a mutated mock. */
const renderWith = (showThinking: boolean, element?: React.ReactElement) => {
  const store = createStore();
  store.set(showThinkingAtom, showThinking);
  partIndex += 1;
  const ui = element ?? (
    <Reasoning reasoning="<think>secret chain of thought</think>" isLast partKeyIndex={partIndex} />
  );
  const wrap = (isSubmitting: boolean, child: React.ReactElement = ui) => (
    <JotaiProvider store={store}>
      <MessageContext.Provider
        value={{ messageId: 'msg-r', isExpanded: false, isSubmitting, isLatestMessage: true }}
      >
        {child}
      </MessageContext.Provider>
    </JotaiProvider>
  );
  const result = render(wrap(true));
  const finish = (child?: React.ReactElement) =>
    act(() => {
      result.rerender(wrap(false, child));
    });
  return { ...result, wrap, finish };
};

describe('Reasoning thinking indicator', () => {
  it('shows only the Thinking label while streaming', () => {
    renderWith(false);
    expect(screen.getByText('com_ui_thinking')).toBeInTheDocument();
    expect(screen.queryByText(/secret chain of thought/)).not.toBeInTheDocument();
  });

  it('hides live text even when Show Thinking is on', () => {
    renderWith(true);
    expect(screen.getByText('com_ui_thinking')).toBeInTheDocument();
    expect(screen.queryByText(/secret chain of thought/)).not.toBeInTheDocument();
  });

  it('falls back to Thoughts for a finished thought it never saw stream', () => {
    const { rerender, wrap } = renderWith(false);
    partIndex += 1;
    rerender(
      wrap(
        false,
        <Reasoning reasoning="<think>old thought</think>" isLast partKeyIndex={partIndex} />,
      ),
    );
    expect(screen.getByText('com_ui_thoughts')).toBeInTheDocument();
  });

  it('reads Thought for Ns once a thought it watched finishes', () => {
    const { finish } = renderWith(false);
    finish();
    expect(screen.getByText('com_ui_thought_for:1')).toBeInTheDocument();
    expect(screen.queryByText(/secret chain of thought/)).not.toBeInTheDocument();
  });

  it('opens the finished thought when Show Thinking is on', () => {
    const { finish } = renderWith(true);
    finish();
    expect(screen.getByText('secret chain of thought')).toBeInTheDocument();
  });
});

describe('ReasoningCompact thinking indicator', () => {
  const compact = (isStreaming: boolean, key: number) => (
    <ReasoningCompact
      reasoning="hidden compact thought"
      label={isStreaming ? 'com_ui_thinking' : 'com_ui_thoughts'}
      showThinking
      isStreaming={isStreaming}
      partKeyIndex={key}
    />
  );

  it('keeps text hidden while streaming even when Show Thinking is on', () => {
    renderWith(true, compact(true, 900));
    expect(screen.getByText('com_ui_thinking')).toBeInTheDocument();
    expect(screen.queryByText('hidden compact thought')).not.toBeInTheDocument();
  });

  it('reads Thought for Ns after streaming ends', () => {
    const { finish } = renderWith(false, compact(true, 901));
    finish(compact(false, 901));
    expect(screen.getByText('com_ui_thought_for:1')).toBeInTheDocument();
  });
});
