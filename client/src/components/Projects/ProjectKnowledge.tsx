import { useRef, useState } from 'react';
import { v4 } from 'uuid';
import { FileText, Pencil, Plus, X } from 'lucide-react';
import { EModelEndpoint, EToolResources } from 'librechat-data-provider';
import { Button, Spinner, TooltipAnchor, useToastContext } from '@librechat/client';
import type { TChatProject } from 'librechat-data-provider';
import type { ChangeEvent } from 'react';
import {
  useUploadFileMutation,
  useProjectKnowledgeQuery,
  useAddProjectKnowledgeMutation,
  useRemoveProjectKnowledgeMutation,
} from '~/data-provider';
import ProjectInstructionsDialog from './ProjectInstructionsDialog';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ProjectKnowledgeProps = {
  project: TChatProject;
  className?: string;
};

const SIZE_UNITS = [
  { unit: 'megabyte', bytes: 1024 * 1024 },
  { unit: 'kilobyte', bytes: 1024 },
  { unit: 'byte', bytes: 1 },
];

const formatSize = (bytes: number): string => {
  const { unit, bytes: base } =
    SIZE_UNITS.find((entry) => bytes >= entry.bytes) ?? SIZE_UNITS[SIZE_UNITS.length - 1];
  return new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / base);
};

/** Knowledge files are stored as extracted text, so chats in the project can read them. */
function buildKnowledgeUpload(file: File): FormData {
  const formData = new FormData();
  formData.append('endpoint', EModelEndpoint.agents);
  formData.append('file', file, encodeURIComponent(file.name));
  formData.append('file_id', v4());
  formData.append('message_file', 'true');
  formData.append('tool_resource', EToolResources.context);
  return formData;
}

export default function ProjectKnowledge({ project, className }: ProjectKnowledgeProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const { data, isLoading } = useProjectKnowledgeQuery(project._id);
  const uploadFile = useUploadFileMutation();
  const addKnowledge = useAddProjectKnowledgeMutation();
  const removeKnowledge = useRemoveProjectKnowledgeMutation();
  const files = data?.files ?? [];
  const instructions = project.instructions?.trim() ?? '';

  const showError = (message: string) =>
    showToast({ message, severity: NotificationSeverity.ERROR, showIcon: true });

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selected.length === 0) {
      return;
    }
    setUploading(selected.map((file) => file.name));
    const results = await Promise.allSettled(
      selected.map((file) => uploadFile.mutateAsync(buildKnowledgeUpload(file))),
    );
    setUploading([]);

    const fileIds = results.flatMap((result) =>
      result.status === 'fulfilled' && result.value?.file_id ? [result.value.file_id] : [],
    );
    if (fileIds.length < selected.length) {
      showError(localize('com_ui_project_knowledge_upload_error'));
    }
    if (fileIds.length === 0) {
      return;
    }
    addKnowledge.mutate(
      { projectId: project._id, file_ids: fileIds },
      { onError: () => showError(localize('com_ui_project_knowledge_add_error')) },
    );
  };

  const handleRemove = (fileId: string) =>
    removeKnowledge.mutate(
      { projectId: project._id, file_id: fileId },
      { onError: () => showError(localize('com_ui_project_knowledge_remove_error')) },
    );

  return (
    <aside
      aria-label={localize('com_ui_project_knowledge')}
      className={cn('flex flex-col gap-5 rounded-2xl border border-border-light p-4', className)}
    >
      <section aria-labelledby={`project-instructions-${project._id}`}>
        <div className="flex items-center justify-between gap-2">
          <h2
            id={`project-instructions-${project._id}`}
            className="text-sm font-medium text-text-primary"
          >
            {localize('com_ui_instructions')}
          </h2>
          <TooltipAnchor
            description={localize('com_ui_project_instructions_edit')}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-text-secondary hover:text-text-primary"
                aria-label={localize('com_ui_project_instructions_edit')}
                onClick={() => setIsInstructionsOpen(true)}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
            }
          />
        </div>
        {instructions ? (
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-text-secondary">
            {instructions}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setIsInstructionsOpen(true)}
            className="mt-1 text-left text-sm text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          >
            {localize('com_ui_project_instructions_empty')}
          </button>
        )}
      </section>

      <section aria-labelledby={`project-files-${project._id}`}>
        <div className="flex items-center justify-between gap-2">
          <h2
            id={`project-files-${project._id}`}
            className="flex items-baseline gap-2 text-sm font-medium text-text-primary"
          >
            {localize('com_ui_files')}
            <span className="tabular-nums text-text-secondary">{files.length}</span>
          </h2>
          <TooltipAnchor
            description={localize('com_ui_project_knowledge_add')}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-text-secondary hover:text-text-primary"
                aria-label={localize('com_ui_project_knowledge_add')}
                disabled={uploading.length > 0 || addKnowledge.isLoading}
                onClick={() => inputRef.current?.click()}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            }
          />
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="project-knowledge-input"
            onChange={handleFiles}
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-3">
            <Spinner className="size-4 text-text-secondary" />
          </div>
        ) : null}

        {!isLoading && files.length === 0 && uploading.length === 0 ? (
          <p className="mt-1 text-sm text-text-tertiary">
            {localize('com_ui_project_knowledge_empty')}
          </p>
        ) : null}

        <ul className="mt-2 flex flex-col gap-1">
          {files.map((file) => (
            <li
              key={file.file_id}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-hover"
            >
              <FileText className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-primary">{file.filename}</span>
                <span className="block text-xs text-text-secondary">
                  {file.textLength > 0
                    ? formatSize(file.bytes)
                    : localize('com_ui_project_knowledge_no_text')}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-text-secondary hover:text-text-primary"
                aria-label={localize('com_ui_project_knowledge_remove', { name: file.filename })}
                disabled={removeKnowledge.isLoading}
                onClick={() => handleRemove(file.file_id)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {uploading.map((name) => (
            <li key={`uploading-${name}`} className="flex items-center gap-2.5 px-2 py-1.5">
              <Spinner className="size-4 shrink-0 text-text-secondary" />
              <span className="truncate text-sm text-text-secondary">{name}</span>
            </li>
          ))}
        </ul>
      </section>

      <ProjectInstructionsDialog
        open={isInstructionsOpen}
        onOpenChange={setIsInstructionsOpen}
        project={project}
      />
    </aside>
  );
}
