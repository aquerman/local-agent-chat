import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { useProjectQuery } from '~/data-provider';
import { useOpenProjectChat } from './navigation';
import { useLocalize } from '~/hooks';

/**
 * `/projects/:projectId`: a project opens in its project chat, with the threads panel beside
 * it, the way a Claude project does. The overview page lives at `/projects/:projectId/overview`.
 */
export default function ProjectHome() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const openProjectChat = useOpenProjectChat();
  const opened = useRef(false);
  const { data: project, isLoading } = useProjectQuery(projectId, {
    refetchOnMount: 'always',
    retry: false,
  });

  useEffect(() => {
    if (opened.current || !project || project._id !== projectId) {
      return;
    }
    opened.current = true;
    openProjectChat(project, { replace: true });
  }, [openProjectChat, project, projectId]);

  if (!isLoading && !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-presentation px-6 text-center">
        <p className="text-sm text-text-secondary">{localize('com_ui_project_not_found')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/projects')}>
          {localize('com_ui_all_projects')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-presentation">
      <Spinner className="text-text-primary" />
    </div>
  );
}
