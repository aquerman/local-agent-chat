import { memo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useProjectQuery } from '~/data-provider';
import { useOpenProjectChat } from '../navigation';
import { useLocalize } from '~/hooks';

/**
 * In a thread or other chat of a project, the way back to the project chat, named after the
 * project. Hidden in the project chat itself and outside projects.
 */
function ProjectCrumb({
  projectId,
  conversationId,
}: {
  projectId?: string | null;
  conversationId?: string | null;
}) {
  const localize = useLocalize();
  const openProjectChat = useOpenProjectChat();
  const { data: project } = useProjectQuery(projectId, { staleTime: 30000 });

  const coordinatorId = project?.coordinatorConversationId;
  if (!project || !coordinatorId || !conversationId || conversationId === coordinatorId) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="project-crumb"
      onClick={() => openProjectChat(project)}
      aria-label={localize('com_ui_project_chat_back', { name: project.name })}
      className="flex min-w-0 shrink items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-normal text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="max-w-48 truncate">{project.name}</span>
    </button>
  );
}

export default memo(ProjectCrumb);
