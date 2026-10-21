import { useId, useState } from 'react';
import { MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH } from 'librechat-data-provider';
import {
  Label,
  Button,
  Spinner,
  Textarea,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TChatProject } from 'librechat-data-provider';
import type { FormEvent } from 'react';
import { useUpdateProjectMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

type ProjectInstructionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: TChatProject;
};

export default function ProjectInstructionsDialog({
  open,
  onOpenChange,
  project,
}: ProjectInstructionsDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const { showToast } = useToastContext();
  const updateProject = useUpdateProjectMutation();
  const [instructions, setInstructions] = useState(project.instructions ?? '');
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setInstructions(project.instructions ?? '');
    }
  }

  const trimmed = instructions.trim();
  const isUnchanged = trimmed === (project.instructions ?? '').trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isUnchanged || updateProject.isLoading) {
      return;
    }
    updateProject.mutate(
      { projectId: project._id, instructions: trimmed },
      {
        onSuccess: () => onOpenChange(false),
        onError: () =>
          showToast({
            message: localize('com_ui_project_instructions_error'),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          }),
      },
    );
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_project_instructions_title')}
        description={localize('com_ui_project_instructions_description', { name: project.name })}
        showCloseButton={false}
        className="w-11/12 max-w-2xl"
        main={
          <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-instructions`} className="sr-only">
              {localize('com_ui_instructions')}
            </Label>
            <Textarea
              id={`${formId}-instructions`}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH}
              placeholder={localize('com_ui_project_instructions_placeholder')}
              rows={10}
              className="min-h-[12rem] bg-transparent"
            />
            <p className="text-right text-xs tabular-nums text-text-secondary">
              {localize('com_ui_project_instructions_count', {
                count: instructions.length,
                max: MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH,
              })}
            </p>
          </form>
        }
        buttons={
          <Button
            type="submit"
            form={formId}
            variant="submit"
            disabled={isUnchanged || updateProject.isLoading}
            className="active:scale-[0.96]"
          >
            {updateProject.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
