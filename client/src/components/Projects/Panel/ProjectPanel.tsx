import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Constants, QueryKeys } from 'librechat-data-provider';
import { Button, Spinner, TooltipAnchor } from '@librechat/client';
import { ChevronDown, Folder, MessagesSquare, Plus, Settings2, X } from 'lucide-react';
import type {
  TConversation,
  TProjectThread,
  TProjectThreadStatus,
  ConversationListResponse,
} from 'librechat-data-provider';
import { useActiveJobs, useConversationsInfiniteQuery, useProjectQuery } from '~/data-provider';
import { useOpenProjectChat, useStartProjectChat } from '../navigation';
import { useLocalize, useNavigateToConvo } from '~/hooks';
import ProjectKnowledge from '../ProjectKnowledge';
import ThreadStatusChip from '../ThreadStatusChip';
import { useProjectThreadList } from '../threads';
import { cn } from '~/utils';

type ProjectPanelProps = {
  projectId: string;
  /** The chat open beside the panel, to mark its row. */
  conversationId?: string | null;
  /** Whether that chat is generating; when a turn ends, threads and the project are refetched. */
  isSubmitting: boolean;
  onClose: () => void;
  /** Shown as a drawer over the chat: picking a row also closes it. */
  closeOnNavigate?: boolean;
  className?: string;
};

type PanelRow = {
  conversationId: string;
  title: string;
  status?: TProjectThreadStatus | null;
  detail?: string;
  sortKey: string;
  conversation?: TConversation;
};

const plainText = (text?: string): string | undefined => text?.replace(/[*_`#>]/g, '').trim();

/**
 * The project's chats beside the chat: the project chat (the coordinator) first, then the
 * threads it started and the other chats in the project, newest first, with live status.
 * A thread is an ordinary chat, so opening one is how the user talks to it.
 */
export function buildPanelRows(
  conversations: TConversation[],
  threads: TProjectThread[],
  coordinatorId?: string | null,
): PanelRow[] {
  const threadsByConversation = new Map(threads.map((thread) => [thread.conversationId, thread]));
  const rows: PanelRow[] = [];
  const seen = new Set<string>();
  for (const conversation of conversations) {
    const id = conversation.conversationId;
    if (!id || id === coordinatorId || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const thread = threadsByConversation.get(id);
    rows.push({
      conversationId: id,
      title: conversation.title || thread?.title || '',
      status: thread?.status ?? conversation.threadStatus,
      detail: plainText(thread?.summary || thread?.error),
      sortKey: conversation.updatedAt || conversation.createdAt || thread?.updatedAt || '',
      conversation,
    });
  }
  for (const thread of threads) {
    if (seen.has(thread.conversationId) || thread.conversationId === coordinatorId) {
      continue;
    }
    rows.push({
      conversationId: thread.conversationId,
      title: thread.title,
      status: thread.status,
      detail: plainText(thread.summary || thread.error),
      sortKey: thread.updatedAt,
    });
  }
  return rows.sort((a, b) => {
    if (a.sortKey === b.sortKey) {
      return 0;
    }
    return a.sortKey < b.sortKey ? 1 : -1;
  });
}

const rowClass = (active: boolean) =>
  cn(
    'flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left transition-colors',
    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
    'disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent',
    active && 'bg-surface-active-alt hover:bg-surface-active-alt',
  );

function ProjectPanel({
  projectId,
  conversationId,
  isSubmitting,
  onClose,
  closeOnNavigate = false,
  className,
}: ProjectPanelProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { navigateToConvo } = useNavigateToConvo();
  const openProjectChat = useOpenProjectChat();
  const startProjectChat = useStartProjectChat();
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false);
  const { data: project } = useProjectQuery(projectId, { staleTime: 30000 });
  const { threads, isLoading: isThreadsLoading } = useProjectThreadList(projectId);
  const { data, fetchNextPage, isFetchingNextPage, isLoading } = useConversationsInfiniteQuery(
    { projectId, sortBy: 'updatedAt', sortDirection: 'desc' },
    { staleTime: 30000, cacheTime: 300000 },
  );
  const { data: activeJobsData } = useActiveJobs();
  const activeJobIds = useMemo(
    () => new Set(activeJobsData?.activeJobIds ?? []),
    [activeJobsData?.activeJobIds],
  );

  /** A coordinator turn can start a thread or make this chat the coordinator. */
  const wasSubmitting = useRef(isSubmitting);
  useEffect(() => {
    if (wasSubmitting.current && !isSubmitting) {
      queryClient.invalidateQueries([QueryKeys.projectThreads, projectId]);
      queryClient.invalidateQueries([QueryKeys.project, projectId]);
    }
    wasSubmitting.current = isSubmitting;
  }, [isSubmitting, projectId, queryClient]);

  const coordinatorId = project?.coordinatorConversationId ?? null;
  const conversations = useMemo(
    () => (data?.pages.flatMap((page) => page.conversations) ?? []).filter(Boolean),
    [data?.pages],
  );
  const rows = useMemo(
    () => buildPanelRows(conversations, threads, coordinatorId),
    [conversations, threads, coordinatorId],
  );
  const lastPage: ConversationListResponse | undefined = data?.pages[data.pages.length - 1];
  const hasNextPage = lastPage != null && lastPage.nextCursor != null;

  const isProjectChatActive = coordinatorId
    ? conversationId === coordinatorId
    : conversationId == null || conversationId === Constants.NEW_CONVO;
  const coordinatorBusy = coordinatorId != null && activeJobIds.has(coordinatorId);

  const afterNavigate = () => {
    if (closeOnNavigate) {
      onClose();
    }
  };

  const openRow = (row: PanelRow) => {
    if (row.conversation) {
      navigateToConvo(row.conversation);
    } else {
      navigate(`/c/${encodeURIComponent(row.conversationId)}`);
    }
    afterNavigate();
  };

  if (!project) {
    return (
      <aside className={cn('flex h-full items-center justify-center', className)}>
        <Spinner className="size-4 text-text-secondary" />
      </aside>
    );
  }

  const headingId = `project-panel-${project._id}`;
  return (
    <aside
      aria-labelledby={headingId}
      data-testid="project-panel"
      className={cn('flex h-full min-h-0 flex-col bg-presentation text-text-primary', className)}
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
        <Folder className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {project.name}
        </h2>
        <TooltipAnchor
          description={localize('com_ui_project_overview')}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-text-secondary hover:text-text-primary"
              aria-label={localize('com_ui_project_overview')}
              onClick={() => {
                navigate(`/projects/${encodeURIComponent(project._id)}/overview`);
                afterNavigate();
              }}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-text-secondary hover:text-text-primary"
          aria-label={localize('com_ui_close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4">
        <button
          type="button"
          aria-current={isProjectChatActive ? 'page' : undefined}
          onClick={() => {
            openProjectChat(project);
            afterNavigate();
          }}
          className={cn(
            rowClass(isProjectChatActive),
            'flex-row items-center gap-3 rounded-xl border border-border-light px-3 py-2.5',
          )}
        >
          <MessagesSquare className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {localize('com_ui_project_chat')}
            </span>
            <span className="block truncate text-xs text-text-secondary">
              {localize('com_ui_project_chat_hint')}
            </span>
          </span>
          {coordinatorBusy ? (
            <Spinner
              className="h-4 w-4 shrink-0 text-text-primary"
              aria-label={localize('com_ui_generating')}
            />
          ) : null}
        </button>

        <section aria-labelledby={`${headingId}-threads`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 px-2">
            <h3
              id={`${headingId}-threads`}
              className="flex items-baseline gap-2 text-xs font-medium uppercase tracking-wide text-text-secondary"
            >
              {localize('com_ui_project_threads')}
              <span className="tabular-nums">{rows.length}</span>
            </h3>
            {coordinatorId ? (
              <TooltipAnchor
                description={localize('com_ui_project_thread_new')}
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-text-secondary hover:text-text-primary"
                    aria-label={localize('com_ui_project_thread_new')}
                    onClick={() => {
                      startProjectChat(project._id);
                      afterNavigate();
                    }}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                }
              />
            ) : null}
          </div>
          {(isLoading || isThreadsLoading) && rows.length === 0 ? (
            <div className="flex justify-center py-3">
              <Spinner className="size-4 text-text-secondary" />
            </div>
          ) : null}
          {!isLoading && !isThreadsLoading && rows.length === 0 ? (
            <p className="px-2 text-sm text-text-tertiary">
              {localize('com_ui_project_threads_empty')}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {rows.map((row) => {
              const active = row.conversationId === conversationId;
              /** A queued thread has no chat until its first run starts. */
              const waiting = row.conversation == null && row.status === 'working';
              return (
                <li key={row.conversationId}>
                  <button
                    type="button"
                    disabled={waiting}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => openRow(row)}
                    className={rowClass(active)}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {row.title || localize('com_ui_untitled')}
                      </span>
                      {activeJobIds.has(row.conversationId) ? (
                        <Spinner
                          className="h-3.5 w-3.5 shrink-0 text-text-primary"
                          aria-label={localize('com_ui_generating')}
                        />
                      ) : null}
                      <ThreadStatusChip status={row.status} className="shrink-0" />
                    </span>
                    {row.detail ? (
                      <span className="line-clamp-2 text-xs text-text-secondary">{row.detail}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {hasNextPage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start text-text-secondary"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {localize('com_ui_show_more')}
            </Button>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={isKnowledgeOpen}
            onClick={() => setIsKnowledgeOpen((open) => !open)}
            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs font-medium uppercase tracking-wide text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            {localize('com_ui_project_knowledge')}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', isKnowledgeOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
          {isKnowledgeOpen ? <ProjectKnowledge project={project} /> : null}
        </section>
      </div>
    </aside>
  );
}

export default memo(ProjectPanel);
