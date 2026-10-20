import React, { memo, useMemo, type MutableRefObject } from 'react';
import { SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react/unstyled';
import type {
  SandpackProviderProps,
  SandpackPreviewRef,
} from '@codesandbox/sandpack-react/unstyled';
import type { SandpackStartupConfig } from '~/utils/artifacts';
import type { ArtifactFiles } from '~/common';
import { sharedFiles, buildSandpackOptions, isSelfHostedPreview } from '~/utils/artifacts';
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
  const selfHosted = isSelfHostedPreview(template, startupConfig);

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

  const options: SandpackProviderProps['options'] = useMemo(
    () => buildSandpackOptions(template, startupConfig),
    [startupConfig, template],
  );

  if (Object.keys(artifactFiles).length === 0) {
    return null;
  }

  return (
    <SandpackProvider
      files={{ ...artifactFiles, ...sharedFiles }}
      options={options}
      {...sharedProps}
      template={template}
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
