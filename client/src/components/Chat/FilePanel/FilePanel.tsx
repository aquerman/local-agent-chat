import { lazy, Suspense, useRef, useState, useEffect, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { Button } from '@librechat/client';
import { Download, FileText, X } from 'lucide-react';
import type { FilePanelKind, FilePanelFile } from './kind';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { getDownloadFilename, logger, triggerDownload } from '~/utils';
import { useFileDownload, useFilePreviewBlob } from '~/data-provider';
import { isOfficePanelKind } from './kind';
import { useLocalize } from '~/hooks';
import store from '~/store';

/** The Office renderers weigh about a megabyte, so they load only when a DOCX or PPTX is opened. */
const OfficePreview = lazy(() => import('./OfficePreview'));

type LoadState = 'loading' | 'ready' | 'error';

interface FilePanelProps {
  file: FilePanelFile;
  kind: FilePanelKind;
  onClose: () => void;
}

export default function FilePanel({ file, kind, onClose }: FilePanelProps) {
  const localize = useLocalize();
  const user = useRecoilValue(store.user);
  const fileName = file.filename ?? '';
  const { refetch: previewFile } = useFilePreviewBlob(user?.id, file.file_id);
  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', file.file_id, {
    direct: false,
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [officeBlob, setOfficeBlob] = useState<Blob | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [textOpen, setTextOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  /** Focus lands on Close when the panel opens, so Escape and Enter work straight away. */
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setObjectUrl(null);
    setOfficeBlob(null);
    setLoadState('loading');

    const load = async () => {
      try {
        const { data: blob } = await previewFile();
        if (!blob) {
          throw new Error('Preview download unavailable');
        }
        if (cancelled) {
          return;
        }
        if (isOfficePanelKind(kind)) {
          setOfficeBlob(blob);
          setLoadState('ready');
          return;
        }
        /** The download endpoint may answer with a generic type; the browser only renders a PDF in a frame when told it is one. */
        const type = kind === 'pdf' ? 'application/pdf' : blob.type || file.type || '';
        url = URL.createObjectURL(new Blob([blob], { type }));
        setObjectUrl(url);
        setLoadState('ready');
      } catch (error) {
        logger.error('[FilePanel] Preview failed:', error);
        if (!cancelled) {
          setLoadState('error');
        }
      }
    };
    void load();

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [file.file_id, file.type, kind, previewFile]);

  const handleDownload = useCallback(async () => {
    try {
      const result = await downloadFile();
      if (!result.data) {
        return;
      }
      triggerDownload(result.data, getDownloadFilename(fileName, file.file_id, file.source));
    } catch (error) {
      logger.error('[FilePanel] Download failed:', error);
    }
  }, [downloadFile, fileName, file.file_id, file.source]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape' && !textOpen) {
        onClose();
      }
    },
    [onClose, textOpen],
  );

  const previewLabel = `${localize('com_ui_preview')}: ${fileName}`;

  return (
    <section
      aria-label={previewLabel}
      onKeyDown={handleKeyDown}
      className="flex h-full w-full flex-col overflow-hidden bg-surface-primary text-text-primary shadow-2xl"
    >
      <div className="flex h-[52px] flex-shrink-0 items-center justify-between gap-2 border-b border-border-light bg-surface-primary-alt p-2">
        <h2 className="min-w-0 truncate px-2 text-sm font-medium" title={fileName}>
          {fileName}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {file.llmDeliveryPath === 'text' && (
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => setTextOpen(true)}
              aria-label={localize('com_ui_view_extracted_text')}
              title={localize('com_ui_view_extracted_text')}
            >
              <FileText size={16} aria-hidden="true" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={handleDownload}
            aria-label={`${localize('com_ui_download')} ${fileName}`}
            title={localize('com_ui_download')}
          >
            <Download size={16} aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            ref={closeRef}
            onClick={onClose}
            aria-label={localize('com_ui_close')}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {loadState === 'loading' && (
          <span className="shimmer text-sm text-text-secondary" role="status">
            {localize('com_ui_loading')}
          </span>
        )}
        {loadState === 'error' && (
          <span className="text-sm text-text-secondary" role="alert">
            {localize('com_ui_preview_failed')}
          </span>
        )}
        {objectUrl && kind === 'pdf' && (
          <iframe src={objectUrl} title={previewLabel} className="h-full w-full border-0" />
        )}
        {objectUrl && kind === 'image' && (
          <img
            src={objectUrl}
            alt={fileName}
            className="max-h-full max-w-full object-contain p-4"
          />
        )}
        {officeBlob && isOfficePanelKind(kind) && (
          <Suspense
            fallback={
              <span className="shimmer text-sm text-text-secondary" role="status">
                {localize('com_ui_loading')}
              </span>
            }
          >
            <OfficePreview blob={officeBlob} kind={kind} title={previewLabel} />
          </Suspense>
        )}
      </div>

      {file.llmDeliveryPath === 'text' && (
        <FilePreviewDialog
          open={textOpen}
          onOpenChange={setTextOpen}
          fileName={fileName}
          fileId={file.file_id}
          fileType={file.type ?? undefined}
          fileSource={file.source}
          fileSize={file.bytes}
          deliveryPath={file.llmDeliveryPath}
        />
      )}
    </section>
  );
}
