import { dataService, QueryKeys } from 'librechat-data-provider';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  TChatProject,
  ProjectListParams,
  ProjectListResponse,
  TProjectThreadsResponse,
  TChatProjectKnowledgeResponse,
} from 'librechat-data-provider';
import type {
  UseInfiniteQueryOptions,
  QueryObserverResult,
  UseQueryOptions,
} from '@tanstack/react-query';

export const useProjectsInfiniteQuery = (
  params: ProjectListParams = {},
  config?: UseInfiniteQueryOptions<ProjectListResponse, unknown>,
) => {
  const { sortBy, sortDirection, search, limit } = params;

  return useInfiniteQuery<ProjectListResponse>({
    queryKey: [QueryKeys.projects, { sortBy, sortDirection, search, limit }],
    queryFn: ({ pageParam }) =>
      dataService.listProjects({
        sortBy,
        sortDirection,
        search,
        limit,
        cursor: pageParam?.toString(),
      }),
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    keepPreviousData: true,
    staleTime: 5 * 60 * 1000,
    cacheTime: 30 * 60 * 1000,
    ...config,
  });
};

export const useProjectQuery = (
  projectId?: string | null,
  config?: UseQueryOptions<TChatProject>,
): QueryObserverResult<TChatProject, unknown> => {
  return useQuery<TChatProject>(
    [QueryKeys.project, projectId],
    () => dataService.getProjectById(projectId ?? ''),
    {
      enabled: Boolean(projectId),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useProjectKnowledgeQuery = (
  projectId?: string | null,
  config?: UseQueryOptions<TChatProjectKnowledgeResponse>,
): QueryObserverResult<TChatProjectKnowledgeResponse, unknown> => {
  return useQuery<TChatProjectKnowledgeResponse>(
    [QueryKeys.projectKnowledge, projectId],
    () => dataService.getProjectKnowledge(projectId ?? ''),
    {
      enabled: Boolean(projectId),
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};

/** Polls while a thread is working or waiting, so status badges follow background runs. */
export const THREADS_POLL_MS = 10_000;

export const useProjectThreadsQuery = (
  projectId?: string | null,
  config?: UseQueryOptions<TProjectThreadsResponse>,
): QueryObserverResult<TProjectThreadsResponse, unknown> => {
  return useQuery<TProjectThreadsResponse>(
    [QueryKeys.projectThreads, projectId],
    () => dataService.getProjectThreads(projectId ?? ''),
    {
      enabled: Boolean(projectId),
      refetchOnWindowFocus: true,
      refetchInterval: (data) =>
        data?.threads.some((thread) => thread.status === 'working' || thread.status === 'needs_you')
          ? THREADS_POLL_MS
          : false,
      ...config,
    },
  );
};
