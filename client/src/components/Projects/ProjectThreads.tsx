import { useEffect, useRef } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { QueryKeys } from 'librechat-data-provider';
import { Button, Spinner } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import type { TChatProject, TProjectThread } from 'librechat-data-provider';
import { useProjectThreadsQuery } from '~/data-provider';
import ThreadStatusChip from './ThreadStatusChip';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ProjectThreadsProps = {
  project: TChatProject;
  className?: string;
};

const statusSignature = (threads: TProjectThread[]): string =>
  threads.map((thread) => `${thread.id}:${thread.status}`).join(',');

/**
 * The project's coordinator chat and the task threads it started, with live status. Like the
 * thread list of a Claude project: each thread opens as its own chat.
 */
export default function ProjectThreads({ project, className }: ProjectThreadsProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useProjectThreadsQuery(project._id);
  const threads = data?.threads ?? [];
  const coordinatorId = project.coordinatorConversationId;
  const signature = statusSignature(threads);
  const previousSignature = useRef<string | null>(null);

  useEffect(() => {
    if (previousSignature.current != null && previousSignature.current !== signature) {
      queryClient.invalidateQueries([QueryKeys.allConversations]);
    }
    previousSignature.current = signature;
  }, [signature, queryClient]);

  return (
    <section
      aria-labelledby={`project-threads-${project._id}`}
      className={cn('flex flex-col gap-2 rounded-2xl border border-border-light p-4', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={`project-threads-${project._id}`}
          className="flex items-baseline gap-2 text-sm font-medium text-text-primary"
        >
          {localize('com_ui_project_threads')}
          <span className="tabular-nums text-text-secondary">{threads.length}</span>
        </h2>
        {coordinatorId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate(`/c/${encodeURIComponent(coordinatorId)}`)}
          >
            <MessagesSquare className="h-4 w-4" aria-hidden="true" />
            {localize('com_ui_project_coordinator_open')}
          </Button>
        ) : null}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-3">
          <Spinner className="size-4 text-text-secondary" />
        </div>
      ) : null}
      {!isLoading && threads.length === 0 ? (
        <p className="text-sm text-text-tertiary">{localize('com_ui_project_threads_empty')}</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {threads.map((thread) => {
          const detail = (thread.summary || thread.error)?.replace(/[*_`#>]/g, '');
          return (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => navigate(`/c/${encodeURIComponent(thread.conversationId)}`)}
                className="flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                    {thread.title}
                  </span>
                  <ThreadStatusChip status={thread.status} className="shrink-0" />
                </span>
                {detail ? (
                  <span className="line-clamp-2 text-xs text-text-secondary">{detail}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
