import { memo, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { PanelRight } from 'lucide-react';
import { TooltipAnchor, Button } from '@librechat/client';
import { projectPanelOpenAtom, projectPanelSheetAtom, PROJECT_PANEL_WIDE_QUERY } from './state';
import { useLocalize } from '~/hooks';

/** Header button that shows or hides the project panel of a chat inside a project. */
function ProjectPanelToggle({ projectId }: { projectId?: string | null }) {
  const localize = useLocalize();
  const setOpen = useSetAtom(projectPanelOpenAtom);
  const setSheetOpen = useSetAtom(projectPanelSheetAtom);

  const toggle = useCallback(() => {
    if (window.matchMedia(PROJECT_PANEL_WIDE_QUERY).matches) {
      setOpen((open) => !open);
      return;
    }
    setSheetOpen((open) => !open);
  }, [setOpen, setSheetOpen]);

  if (!projectId) {
    return null;
  }

  const label = localize('com_ui_project_panel_toggle');
  return (
    <TooltipAnchor
      description={label}
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          data-testid="project-panel-toggle"
          className="size-9 shrink-0 rounded-xl text-text-secondary hover:text-text-primary"
          onClick={toggle}
        >
          <PanelRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      }
    />
  );
}

export default memo(ProjectPanelToggle);
