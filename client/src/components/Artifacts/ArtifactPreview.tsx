import React, { memo, useMemo, type MutableRefObject } from 'react';
import { SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react/unstyled';
import type {
  SandpackProviderProps,
  SandpackPreviewRef,
} from '@codesandbox/sandpack-react/unstyled';
import type { SandpackStartupConfig } from '~/utils/artifacts';
import type { ArtifactFiles } from '~/common';
import {
  sharedFiles,
  resolveStaticBundler,
  buildSandpackOptions,
  isSelfHostedPreview,
} from '~/utils/artifacts';
import { getOfflineReactFiles, isOfflineReactPreview } from '~/sandbox/preview';
import { withSelfHostedMarked } from '~/utils/markdown';

export const ArtifactPreview = memo(function ({
  files,
  fileKey,
  template,
  sharedProps,
  previewRef,
  currentCode,
  startupConfig,
}: {
  files: ArtifactFiles;
  fileKey: string;
  template: SandpackProviderProps['template'];
  sharedProps: Partial<SandpackProviderProps>;
  previewRef: MutableRefObject<SandpackPreviewRef>;
  currentCode?: string;
  startupConfig?: SandpackStartupConfig;
}) {
  const offlineReact = isOfflineReactPreview(
    template,
    fileKey,
    resolveStaticBundler(startupConfig?.staticBundlerURL, window.location.hostname).selfHosted,
  );
  const previewTemplate = offlineReact ? 'static' : template;
  const selfHosted = isSelfHostedPreview(previewTemplate, startupConfig);

  const artifactFiles = useMemo(() => {
    if (Object.keys(files).length === 0) {
      return files;
    }
    const localFiles = selfHosted ? withSelfHostedMarked(files) : files;
    const code = currentCode ?? '';
    if (!code) {
      return localFiles;
    }
    return {
      ...localFiles,
      [fileKey]: { code },
    };
  }, [currentCode, files, fileKey, selfHosted]);

  const previewFiles = useMemo(() => {
    const allFiles = { ...artifactFiles, ...sharedFiles };
    return offlineReact ? getOfflineReactFiles(allFiles) : allFiles;
  }, [artifactFiles, offlineReact]);

  const options: SandpackProviderProps['options'] = useMemo(
    () => buildSandpackOptions(previewTemplate, startupConfig),
    [startupConfig, previewTemplate],
  );

  if (Object.keys(artifactFiles).length === 0) {
    return null;
  }

  return (
    <SandpackProvider
      files={previewFiles}
      options={options}
      {...(offlineReact ? {} : sharedProps)}
      template={previewTemplate}
    >
      <SandpackPreview
        showOpenInCodeSandbox={false}
        showRefreshButton={false}
        tabIndex={0}
        ref={previewRef}
      />
    </SandpackProvider>
  );
});
