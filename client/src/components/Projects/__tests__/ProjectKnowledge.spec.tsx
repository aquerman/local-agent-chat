import { RecoilRoot } from 'recoil';
import { dataService, EToolResources } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { TChatProject, TFileUpload, TStartupConfig } from 'librechat-data-provider';
import ProjectKnowledge from '../ProjectKnowledge';

/** A plain copy of the data service, so its network calls can be spied on. */
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values?.name != null ? `${key}:${values.name}` : key,
}));

const project: TChatProject = {
  _id: '6650f0c2a1b2c3d4e5f60718',
  name: 'Treasure Map',
  instructions: 'Always answer in pirate speak.',
  knowledgeFileIds: ['crew'],
  conversationCount: 0,
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
};

const crewFile = {
  file_id: 'crew',
  filename: 'crew.md',
  type: 'text/markdown',
  bytes: 2048,
  embedded: false,
  textLength: 2000,
};

function renderKnowledge(target: TChatProject = project) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <ProjectKnowledge project={target} />
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

describe('ProjectKnowledge', () => {
  beforeEach(() => {
    jest
      .spyOn(dataService, 'getStartupConfig')
      .mockResolvedValue({ fileUploadSseEnabled: false } as TStartupConfig);
    jest.spyOn(dataService, 'getProjectKnowledge').mockResolvedValue({ files: [crewFile] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the project instructions and its knowledge files', async () => {
    renderKnowledge();

    expect(screen.getByText('Always answer in pirate speak.')).toBeInTheDocument();
    expect(await screen.findByText('crew.md')).toBeInTheDocument();
    expect(dataService.getProjectKnowledge).toHaveBeenCalledWith(project._id);
  });

  it('invites the user to add instructions and files when there are none', async () => {
    jest.spyOn(dataService, 'getProjectKnowledge').mockResolvedValue({ files: [] });
    renderKnowledge({ ...project, instructions: '', knowledgeFileIds: [] });

    expect(screen.getByText('com_ui_project_instructions_empty')).toBeInTheDocument();
    expect(await screen.findByText('com_ui_project_knowledge_empty')).toBeInTheDocument();
  });

  it('uploads a file as extracted text and adds it to the project', async () => {
    const upload = jest
      .spyOn(dataService, 'uploadFile')
      .mockResolvedValue({ file_id: 'server-file-id' } as TFileUpload);
    const add = jest
      .spyOn(dataService, 'addProjectKnowledge')
      .mockResolvedValue({ ...project, knowledgeFileIds: ['crew', 'server-file-id'] });
    renderKnowledge();

    const file = new File(['Ship: Revenge'], 'ship.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByTestId('project-knowledge-input'), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ projectId: project._id, file_ids: ['server-file-id'] }),
    );
    const formData = upload.mock.calls[0][0] as FormData;
    expect(formData.get('tool_resource')).toBe(EToolResources.context);
    expect(formData.get('message_file')).toBe('true');
    expect((formData.get('file') as File).size).toBe(file.size);
  });

  it('does not add anything when every upload fails', async () => {
    jest.spyOn(dataService, 'uploadFile').mockRejectedValue(new Error('unsupported'));
    const add = jest.spyOn(dataService, 'addProjectKnowledge');
    renderKnowledge();

    fireEvent.change(screen.getByTestId('project-knowledge-input'), {
      target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(dataService.uploadFile).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('photo.png')).not.toBeInTheDocument());
    expect(add).not.toHaveBeenCalled();
  });

  it('removes a file from the project', async () => {
    const remove = jest
      .spyOn(dataService, 'removeProjectKnowledge')
      .mockResolvedValue({ ...project, knowledgeFileIds: [] });
    renderKnowledge();

    const row = (await screen.findByText('crew.md')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByLabelText('com_ui_project_knowledge_remove:crew.md'));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ projectId: project._id, file_id: 'crew' }),
    );
  });
});
