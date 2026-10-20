import React, { useMemo, useState } from 'react';
import '@testing-library/jest-dom';
import { DndProvider } from 'react-dnd';
import { useForm } from 'react-hook-form';
import { RecoilRoot, useRecoilState } from 'recoil';
import userEvent from '@testing-library/user-event';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { render, screen } from '@testing-library/react';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryKeys, ReasoningEffort } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TFile, EModelEndpoint, TConversation } from 'librechat-data-provider';
import type { ChatFormValues } from '~/common';
import { ChatContext, ChatFormProvider } from '~/Providers';
import { AuthContextProvider } from '~/hooks/AuthContext';
import ChatForm from '../ChatForm';
import store from '~/store';

/** A Benner chat that already has a reply: the composer's conversation is
 *  memoised on a field list, and the pill must still see a new pick. */
const initialConversation = {
  conversationId: 'conversation-1',
  endpoint: 'Benner' as EModelEndpoint,
  endpointType: 'custom',
  model: 'local',
  title: 'Maths',
  reasoning_effort: ReasoningEffort.high,
  messages: ['m1'],
} as TConversation;

function Harness() {
  const [files, setFiles] = useRecoilState(store.filesByIndex(0));
  const [isSubmitting] = useRecoilState(store.isSubmittingFamily(0));
  const [, setFilesLoading] = useState(false);
  const methods = useForm<ChatFormValues>({ defaultValues: { text: '' } });
  const [conversation, setConversation] = useState<TConversation | null>(initialConversation);

  const chatHelpers = useMemo(
    () =>
      ({
        index: 0,
        conversation,
        setConversation,
        files,
        setFiles,
        isSubmitting,
        setIsSubmitting: () => undefined,
        filesLoading: false,
        setFilesLoading,
        newConversation: () => undefined,
        handleStopGenerating: () => undefined,
        stopGenerating: () => undefined,
        getMessages: () => undefined,
        setMessages: () => undefined,
        ask: () => undefined,
        regenerate: () => undefined,
        setSiblingIdx: () => undefined,
        showPopover: false,
        setShowPopover: () => undefined,
        abortScroll: false,
        setAbortScroll: () => undefined,
        preset: null,
        setPreset: () => undefined,
        optionSettings: {},
        setOptionSettings: () => undefined,
        handleRegenerate: () => undefined,
        handleContinue: () => undefined,
      }) as unknown as React.ContextType<typeof ChatContext>,
    [files, setFiles, isSubmitting, conversation],
  );

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <ChatForm index={0} isLandingPage={false} footerBelow={false} centerFormOnLanding={false} />
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

function renderComposer({ submitting }: { submitting: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<TFile[]>([QueryKeys.files], []);
  queryClient.setQueryData([QueryKeys.endpoints], {
    Benner: { type: 'custom', order: 0, customParams: { reasoningFormat: 'llama_cpp_budget' } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot initializeState={({ set }) => set(store.isSubmittingFamily(0), submitting)}>
        <Router>
          <AuthContextProvider authConfig={{ loginRedirect: '', test: true }}>
            <DndProvider backend={HTML5Backend}>
              <Harness />
            </DndProvider>
          </AuthContextProvider>
        </Router>
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

describe('ChatForm thinking mode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('a new pick shows on the pill after the first message', async () => {
    renderComposer({ submitting: false });

    const pill = await screen.findByTestId('thinking-mode');
    expect(pill).toHaveTextContent('High');
    await userEvent.click(pill);
    await userEvent.click(await screen.findByText('Medium'));

    expect(await screen.findByTestId('thinking-mode')).toHaveTextContent('Medium');
  }, 20000);
});
