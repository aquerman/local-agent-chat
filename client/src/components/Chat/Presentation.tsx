import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useRecoilValue, useResetRecoilState, useSetRecoilState } from 'recoil';
import { EModelEndpoint, FileSources, LocalStorageKeys } from 'librechat-data-provider';
import type { TFile } from 'librechat-data-provider';
import type {
  FilePanelContextValue,
  FilePanelFile,
  FilePanelKind,
} from '~/components/Chat/FilePanel';
import type { ExtendedFile } from '~/common';
import useResetArtifactsOnConversationChange from '~/hooks/Artifacts/useResetArtifactsOnConversationChange';
import { ParentSubagentsProvider } from '~/components/Chat/Subagents/ParentSubagentsProvider';
import { FilePanel, FilePanelContext, getFilePanelKind } from '~/components/Chat/FilePanel';
import DragDropWrapper from '~/components/Chat/Input/Files/DragDropWrapper';
import { activeSubagentPanel } from '~/components/Chat/Subagents/state';
import { EditorProvider, ArtifactsProvider } from '~/Providers';
import { useDeleteFilesMutation } from '~/data-provider';
import { SidePanelGroup } from '~/components/SidePanel';
import AppChatSurface from '~/components/Chat/Surface';
import { useSetFilesToDelete } from '~/hooks';
import { failedFileIdsFrom } from '~/utils';
import store from '~/store';

const Artifacts = lazy(() => import('~/components/Artifacts/Artifacts'));
const SubagentThreadPanel = lazy(() => import('~/components/Chat/Subagents/SubagentThreadPanel'));

export default function Presentation({ children }: { children: React.ReactNode }) {
  const artifacts = useRecoilValue(store.artifactsState);
  const artifactsVisibility = useRecoilValue(store.artifactsVisibility);
  // Render-gating the panel on `currentArtifactId != null` (in addition
  // to visibility + non-empty artifacts) means the side panel only opens
  // when *something* is actively focused. Conversation navigation
  // resets `currentArtifactId` to null, so the panel stays closed when
  // a user revisits an old conversation full of artifacts. New artifacts
  // arriving via SSE auto-focus through `ToolArtifactCard`'s mount effect
  // (gated on `isSubmitting`), restoring the legacy streaming UX.
  const currentArtifactId = useRecoilValue(store.currentArtifactId);
  const conversationId = useRecoilValue(store.conversationIdByIndex(0));
  const conversationEndpoint = useRecoilValue(store.effectiveEndpointByIndex(0));
  const conversationAgentId = useRecoilValue(store.conversationAgentIdByIndex(0));
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(0));
  const selectedSubagent = useAtomValue(activeSubagentPanel);
  const setSelectedSubagent = useSetAtom(activeSubagentPanel);
  const resetSelectedSubagent = useCallback(() => setSelectedSubagent(null), [setSelectedSubagent]);
  const previousConversationIdRef = useRef<string | null>(null);
  const resetCurrentArtifactId = useResetRecoilState(store.currentArtifactId);
  const setArtifactsVisibility = useSetRecoilState(store.artifactsVisibility);
  const [panelFile, setPanelFile] = useState<{ file: FilePanelFile; kind: FilePanelKind } | null>(
    null,
  );
  const closeFilePanel = useCallback(() => setPanelFile(null), []);

  useResetArtifactsOnConversationChange();

  useEffect(() => {
    const previous = previousConversationIdRef.current;
    const next = conversationId ?? null;
    previousConversationIdRef.current = next;
    if (previous != null && previous !== next) {
      resetSelectedSubagent();
      closeFilePanel();
    }
  }, [closeFilePanel, conversationId, resetSelectedSubagent]);

  const openFile = useCallback(
    (file: Partial<TFile>) => {
      const kind = getFilePanelKind(file);
      if (kind == null || file.file_id == null) {
        return false;
      }
      resetCurrentArtifactId();
      setArtifactsVisibility(false);
      resetSelectedSubagent();
      setPanelFile({ file: { ...file, file_id: file.file_id }, kind });
      return true;
    },
    [resetCurrentArtifactId, resetSelectedSubagent, setArtifactsVisibility],
  );

  const openFileId = panelFile?.file.file_id ?? null;
  const filePanelContext = useMemo<FilePanelContextValue>(
    () => ({ openFile, closeFile: closeFilePanel, openFileId }),
    [openFile, closeFilePanel, openFileId],
  );

  const setFilesToDelete = useSetFilesToDelete();

  const { mutateAsync } = useDeleteFilesMutation({
    onSuccess: (result) => {
      console.log('Temporary Files deleted');
      const failed = new Set(failedFileIdsFrom(result));
      if (failed.size === 0) {
        setFilesToDelete({});
        return;
      }
      try {
        const filesToDelete = localStorage.getItem(LocalStorageKeys.FILES_TO_DELETE);
        const map = JSON.parse(filesToDelete ?? '{}') as Record<string, ExtendedFile>;
        const remaining: Record<string, ExtendedFile> = {};
        for (const [key, file] of Object.entries(map)) {
          if (
            (file.file_id != null && failed.has(file.file_id)) ||
            (file.temp_file_id != null && failed.has(file.temp_file_id))
          ) {
            remaining[key] = file;
          }
        }
        setFilesToDelete(remaining);
      } catch {
        // Keep existing records if reading or parsing fails.
      }
    },
    onError: (error) => {
      console.log('Error deleting temporary files:', error);
    },
  });

  useEffect(() => {
    const filesToDelete = localStorage.getItem(LocalStorageKeys.FILES_TO_DELETE);
    const map = JSON.parse(filesToDelete ?? '{}') as Record<string, ExtendedFile>;
    const files = Object.values(map)
      .filter(
        (file) =>
          file.filepath != null && file.source && !(file.embedded ?? false) && file.temp_file_id,
      )
      .map((file) => ({
        file_id: file.file_id,
        filepath: file.filepath as string,
        source: file.source as FileSources,
        embedded: !!(file.embedded ?? false),
      }));

    if (files.length === 0) {
      return;
    }
    mutateAsync({ files });
  }, [mutateAsync]);

  const artifactsElement = useMemo(() => {
    if (
      artifactsVisibility === true &&
      currentArtifactId != null &&
      Object.keys(artifacts ?? {}).length > 0
    ) {
      return (
        <ArtifactsProvider>
          <EditorProvider>
            <Suspense fallback={null}>
              <Artifacts />
            </Suspense>
          </EditorProvider>
        </ArtifactsProvider>
      );
    }
    return null;
  }, [artifactsVisibility, artifacts, currentArtifactId]);

  useEffect(() => {
    if (artifactsElement != null && selectedSubagent != null) resetSelectedSubagent();
  }, [artifactsElement, resetSelectedSubagent, selectedSubagent]);

  /** Opening an artifact or a child thread replaces the document; the panel shows one thing at a time. */
  useEffect(() => {
    if (artifactsElement != null || selectedSubagent != null) closeFilePanel();
  }, [artifactsElement, closeFilePanel, selectedSubagent]);

  const filePanelElement = useMemo(() => {
    if (panelFile == null) {
      return null;
    }
    return (
      <FilePanel
        key={`${panelFile.file.file_id}:${panelFile.file.updatedAt ?? ''}:${panelFile.file.bytes ?? ''}`}
        file={panelFile.file}
        kind={panelFile.kind}
        onClose={closeFilePanel}
      />
    );
  }, [closeFilePanel, panelFile]);

  const subagentElement = useMemo(() => {
    if (
      selectedSubagent == null ||
      selectedSubagent.host !== 'conversation' ||
      selectedSubagent.parentConversationId !== conversationId
    ) {
      return null;
    }
    return (
      <Suspense fallback={null}>
        <SubagentThreadPanel selection={selectedSubagent} />
      </Suspense>
    );
  }, [conversationId, selectedSubagent]);

  const panelElement = artifactsElement ?? filePanelElement ?? subagentElement;

  return (
    <DragDropWrapper className="relative flex w-full grow overflow-hidden bg-presentation">
      <AppChatSurface>
        <ParentSubagentsProvider
          conversationId={conversationId ?? ''}
          enabled={conversationEndpoint === EModelEndpoint.agents && conversationAgentId != null}
          isSubmitting={isSubmitting}
        >
          <FilePanelContext.Provider value={filePanelContext}>
            <SidePanelGroup panel={panelElement}>
              <main className="flex h-full flex-col overflow-y-auto" role="main">
                {children}
              </main>
            </SidePanelGroup>
          </FilePanelContext.Provider>
        </ParentSubagentsProvider>
      </AppChatSurface>
    </DragDropWrapper>
  );
}
