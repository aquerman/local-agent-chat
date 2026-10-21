import { memo } from 'react';
import { Chip } from '@librechat/client';
import type { TProjectThreadStatus } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

type ChipTone = 'info' | 'warning' | 'success' | 'error';

const THREAD_STATUS: Record<TProjectThreadStatus, { label: TranslationKeys; tone: ChipTone }> = {
  working: { label: 'com_ui_thread_status_working', tone: 'info' },
  needs_you: { label: 'com_ui_thread_status_needs_you', tone: 'warning' },
  done: { label: 'com_ui_thread_status_done', tone: 'success' },
  failed: { label: 'com_ui_thread_status_failed', tone: 'error' },
};

/** Status of a project task thread, shown in the project view and the chat lists. */
function ThreadStatusChip({
  status,
  className,
}: {
  status?: TProjectThreadStatus | null;
  className?: string;
}) {
  const localize = useLocalize();
  if (!status) {
    return null;
  }
  const { label, tone } = THREAD_STATUS[status];
  return (
    <Chip tone={tone} className={className} data-testid={`thread-status-${status}`}>
      {localize(label)}
    </Chip>
  );
}

export default memo(ThreadStatusChip);
