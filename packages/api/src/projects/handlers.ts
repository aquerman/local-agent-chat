import { isChatProjectIcon, isChatProjectColor } from 'librechat-data-provider';
import {
  logger,
  isValidObjectIdString,
  CHAT_PROJECT_KNOWLEDGE_LIMIT_ERROR,
  CHAT_PROJECT_KNOWLEDGE_FILE_NOT_FOUND,
} from '@librechat/data-schemas';

import type {
  IProjectThread,
  ChatProjectMethods,
  ProjectThreadMethods,
  ChatProjectSortBy,
  ChatProjectSortDirection,
  CreateChatProjectInput,
  UpdateChatProjectInput,
} from '@librechat/data-schemas';
import type { TProjectThread, TChatProjectIcon, TChatProjectColor } from 'librechat-data-provider';
import type { Request, Response } from 'express';

import { normalizeLimit, queryString } from '~/utils';

const PROJECT_NOT_FOUND = 'Project not found';
const CONVERSATION_NOT_FOUND = 'Conversation not found';

const PROJECT_SORT_FIELDS = new Set<ChatProjectSortBy>(['name', 'createdAt', 'lastConversationAt']);

interface ProjectUser {
  id: string;
  _id?: {
    toString(): string;
  };
}

interface ProjectRequest extends Request {
  user?: ProjectUser;
}

type ProjectHandlerDependencies = Pick<
  ChatProjectMethods,
  | 'listChatProjects'
  | 'createChatProject'
  | 'getChatProject'
  | 'updateChatProject'
  | 'deleteChatProject'
  | 'assignConversationToProject'
  | 'listChatProjectKnowledge'
  | 'addChatProjectKnowledge'
  | 'removeChatProjectKnowledge'
> &
  Partial<Pick<ProjectThreadMethods, 'listProjectThreads'>>;

const toDate = (value?: Date | null): string | null =>
  value ? new Date(value).toISOString() : null;

/** A thread as the project view shows it; the brief and queue fields stay on the server. */
export function toProjectThreadResponse(thread: IProjectThread): TProjectThread {
  return {
    id: thread._id?.toString() ?? '',
    projectId: thread.projectId,
    conversationId: thread.conversationId,
    title: thread.title,
    status: thread.status,
    summary: thread.summary || undefined,
    error: thread.error || undefined,
    createdAt: toDate(thread.createdAt) ?? '',
    updatedAt: toDate(thread.updatedAt) ?? '',
    finishedAt: toDate(thread.finishedAt),
  };
}

const getUserId = (req: ProjectRequest): string => req.user?.id ?? req.user?._id?.toString() ?? '';

const normalizeString = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeSortBy = (value: Request['query'][string]): ChatProjectSortBy | undefined => {
  const sortBy = queryString(value);
  return PROJECT_SORT_FIELDS.has(sortBy as ChatProjectSortBy)
    ? (sortBy as ChatProjectSortBy)
    : undefined;
};

const normalizeSortDirection = (
  value: Request['query'][string],
): ChatProjectSortDirection | undefined => {
  const sortDirection = queryString(value);
  return sortDirection === 'asc' || sortDirection === 'desc' ? sortDirection : undefined;
};

type Appearance = { icon?: TChatProjectIcon | null; color?: TChatProjectColor | null };

/** Reads `icon` and `color` from a body: absent stays absent, null clears, anything else
 *  must name an entry of the fixed set. Returns the field at fault when one does not. */
const parseAppearance = (
  body: ProjectRequest['body'],
): { appearance: Appearance } | { invalid: 'icon' | 'color' } => {
  const appearance: Appearance = {};
  const icon: unknown = body?.icon;
  if (icon !== undefined) {
    if (icon !== null && !isChatProjectIcon(icon)) {
      return { invalid: 'icon' };
    }
    appearance.icon = icon;
  }
  const color: unknown = body?.color;
  if (color !== undefined) {
    if (color !== null && !isChatProjectColor(color)) {
      return { invalid: 'color' };
    }
    appearance.color = color;
  }
  return { appearance };
};

const createProjectInput = (req: ProjectRequest): CreateChatProjectInput | null => {
  const name = normalizeString(req.body?.name);
  if (!name) {
    return null;
  }

  return {
    name,
    description: typeof req.body?.description === 'string' ? req.body.description : '',
    instructions: typeof req.body?.instructions === 'string' ? req.body.instructions : '',
  };
};

const parseFileIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  return value.every((id): id is string => typeof id === 'string' && id.length > 0) ? value : null;
};

export function createProjectHandlers(deps: ProjectHandlerDependencies): {
  listProjects: (req: ProjectRequest, res: Response) => Promise<Response>;
  createProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  assignConversationToProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  getProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  updateProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  deleteProject: (req: ProjectRequest, res: Response) => Promise<Response>;
  listKnowledge: (req: ProjectRequest, res: Response) => Promise<Response>;
  addKnowledge: (req: ProjectRequest, res: Response) => Promise<Response>;
  removeKnowledge: (req: ProjectRequest, res: Response) => Promise<Response>;
  listThreads: (req: ProjectRequest, res: Response) => Promise<Response>;
} {
  async function listProjects(req: ProjectRequest, res: Response): Promise<Response> {
    try {
      const result = await deps.listChatProjects(getUserId(req), {
        cursor: queryString(req.query.cursor),
        limit: normalizeLimit(req.query.limit),
        sortBy: normalizeSortBy(req.query.sortBy),
        sortDirection: normalizeSortDirection(req.query.sortDirection),
        search: queryString(req.query.search),
      });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[projects] Error listing projects', error);
      return res.status(500).json({ error: 'Error listing projects' });
    }
  }

  async function createProject(req: ProjectRequest, res: Response): Promise<Response> {
    const input = createProjectInput(req);
    if (!input) {
      return res.status(400).json({ error: 'name is required' });
    }
    const parsed = parseAppearance(req.body);
    if ('invalid' in parsed) {
      return res.status(400).json({ error: `unknown project ${parsed.invalid}` });
    }

    try {
      const project = await deps.createChatProject(getUserId(req), {
        ...input,
        ...parsed.appearance,
      });
      return res.status(201).json(project);
    } catch (error) {
      logger.error('[projects] Error creating project', error);
      return res.status(500).json({ error: 'Error creating project' });
    }
  }

  async function assignConversationToProject(
    req: ProjectRequest,
    res: Response,
  ): Promise<Response> {
    const { conversationId } = req.params;
    const projectId = req.body?.projectId ?? null;

    if (projectId !== null && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string or null' });
    }

    try {
      const result = await deps.assignConversationToProject(
        getUserId(req),
        conversationId,
        projectId,
      );
      if (!result) {
        return res.status(404).json({ error: CONVERSATION_NOT_FOUND });
      }
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === PROJECT_NOT_FOUND) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      logger.error('[projects] Error assigning conversation to project', error);
      return res.status(500).json({ error: 'Error assigning conversation to project' });
    }
  }

  async function getProject(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    try {
      const project = await deps.getChatProject(getUserId(req), projectId);
      if (!project) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(project);
    } catch (error) {
      logger.error('[projects] Error getting project', error);
      return res.status(500).json({ error: 'Error getting project' });
    }
  }

  async function updateProject(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    const input: UpdateChatProjectInput = {};
    if (req.body?.name !== undefined) {
      const name = normalizeString(req.body.name);
      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }
      input.name = name;
    }
    if (req.body?.description !== undefined) {
      input.description = typeof req.body.description === 'string' ? req.body.description : '';
    }
    if (req.body?.instructions !== undefined) {
      input.instructions = typeof req.body.instructions === 'string' ? req.body.instructions : '';
    }
    const parsed = parseAppearance(req.body);
    if ('invalid' in parsed) {
      return res.status(400).json({ error: `unknown project ${parsed.invalid}` });
    }
    Object.assign(input, parsed.appearance);

    try {
      const project = await deps.updateChatProject(getUserId(req), projectId, input);
      if (!project) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(project);
    } catch (error) {
      logger.error('[projects] Error updating project', error);
      return res.status(500).json({ error: 'Error updating project' });
    }
  }

  async function deleteProject(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    try {
      const result = await deps.deleteChatProject(getUserId(req), projectId);
      if (!result.deletedCount) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[projects] Error deleting project', error);
      return res.status(500).json({ error: 'Error deleting project' });
    }
  }

  async function listKnowledge(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    try {
      const files = await deps.listChatProjectKnowledge(getUserId(req), projectId);
      if (!files) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json({ files });
    } catch (error) {
      logger.error('[projects] Error listing project knowledge', error);
      return res.status(500).json({ error: 'Error listing project knowledge' });
    }
  }

  async function addKnowledge(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }
    const fileIds = parseFileIds(req.body?.file_ids);
    if (!fileIds) {
      return res.status(400).json({ error: 'file_ids must be a non-empty array of strings' });
    }

    try {
      const project = await deps.addChatProjectKnowledge(getUserId(req), projectId, fileIds);
      if (!project) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(project);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === CHAT_PROJECT_KNOWLEDGE_FILE_NOT_FOUND) {
        return res.status(404).json({ error: message });
      }
      if (message === CHAT_PROJECT_KNOWLEDGE_LIMIT_ERROR) {
        return res.status(409).json({ error: message });
      }
      logger.error('[projects] Error adding project knowledge', error);
      return res.status(500).json({ error: 'Error adding project knowledge' });
    }
  }

  async function removeKnowledge(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId, fileId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    try {
      const project = await deps.removeChatProjectKnowledge(getUserId(req), projectId, fileId);
      if (!project) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      return res.status(200).json(project);
    } catch (error) {
      logger.error('[projects] Error removing project knowledge', error);
      return res.status(500).json({ error: 'Error removing project knowledge' });
    }
  }

  async function listThreads(req: ProjectRequest, res: Response): Promise<Response> {
    const { projectId } = req.params;
    if (!isValidObjectIdString(projectId)) {
      return res.status(404).json({ error: PROJECT_NOT_FOUND });
    }

    try {
      const userId = getUserId(req);
      const project = await deps.getChatProject(userId, projectId);
      if (!project) {
        return res.status(404).json({ error: PROJECT_NOT_FOUND });
      }
      const threads = (await deps.listProjectThreads?.(userId, projectId)) ?? [];
      return res.status(200).json({ threads: threads.map(toProjectThreadResponse) });
    } catch (error) {
      logger.error('[projects] Error listing project threads', error);
      return res.status(500).json({ error: 'Error listing project threads' });
    }
  }

  return {
    listThreads,
    listProjects,
    createProject,
    assignConversationToProject,
    getProject,
    updateProject,
    deleteProject,
    listKnowledge,
    addKnowledge,
    removeKnowledge,
  };
}
