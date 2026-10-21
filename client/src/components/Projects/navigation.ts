import { useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { Constants, QueryKeys } from 'librechat-data-provider';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { TChatProject } from 'librechat-data-provider';
import { clearMessagesCache } from '~/utils';
import { useNewConvo } from '~/hooks';
import store from '~/store';

type ProjectRef = Pick<TChatProject, '_id' | 'coordinatorConversationId'>;

/** The project's own chat: its coordinator, or a new chat in the project before there is one. */
export const projectChatPath = (project: ProjectRef): string =>
  project.coordinatorConversationId
    ? `/c/${encodeURIComponent(project.coordinatorConversationId)}`
    : `/c/${Constants.NEW_CONVO}?projectId=${encodeURIComponent(project._id)}`;

/**
 * Starts a new chat filed under a project. From `/c/new` the `?projectId` param is committed in
 * the same turn: `navigate()` defers search-param updates, and ChatRoute would otherwise see a
 * project-scoped draft against an unscoped `/c/new` and wipe it.
 */
export function useStartProjectChat() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { newConversation } = useNewConvo();
  const conversationId = useRecoilValue(store.conversationIdByIndex(0));

  return useCallback(
    (projectId: string, options?: { replace?: boolean }) => {
      clearMessagesCache(queryClient, conversationId);
      queryClient.invalidateQueries([QueryKeys.messages]);
      if (location.pathname === `/c/${Constants.NEW_CONVO}`) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('projectId', projectId);
        setSearchParams(nextParams, { replace: true, flushSync: true });
      } else {
        navigate(`/c/${Constants.NEW_CONVO}?projectId=${encodeURIComponent(projectId)}`, {
          replace: options?.replace,
        });
      }
      newConversation({ template: { chatProjectId: projectId } });
    },
    [
      conversationId,
      location.pathname,
      navigate,
      newConversation,
      queryClient,
      searchParams,
      setSearchParams,
    ],
  );
}

/** Opens a project the way a Claude project opens: in its project (coordinator) chat. */
export function useOpenProjectChat() {
  const navigate = useNavigate();
  const startProjectChat = useStartProjectChat();

  return useCallback(
    (project: ProjectRef, options?: { replace?: boolean }) => {
      if (project.coordinatorConversationId) {
        navigate(projectChatPath(project), { replace: options?.replace });
        return;
      }
      startProjectChat(project._id, options);
    },
    [navigate, startProjectChat],
  );
}
