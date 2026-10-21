import { useEffect, useRef } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import type { TProjectThread } from 'librechat-data-provider';
import { useProjectThreadsQuery } from '~/data-provider';

const statusSignature = (threads: TProjectThread[]): string =>
  threads.map((thread) => `${thread.id}:${thread.status}`).join(',');

/**
 * A project's task threads with live status. When a status changes (a thread started,
 * finished or paused), the chat lists are refetched so their rows and status chips follow.
 */
export function useProjectThreadList(projectId?: string | null) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useProjectThreadsQuery(projectId);
  const threads = data?.threads ?? [];
  const signature = statusSignature(threads);
  const previousSignature = useRef<string | null>(null);

  useEffect(() => {
    if (previousSignature.current != null && previousSignature.current !== signature) {
      queryClient.invalidateQueries([QueryKeys.allConversations]);
    }
    previousSignature.current = signature;
  }, [signature, queryClient]);

  return { threads, isLoading };
}
