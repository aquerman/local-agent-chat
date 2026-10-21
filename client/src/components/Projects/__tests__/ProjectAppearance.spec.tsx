import { useState } from 'react';
import { RecoilRoot } from 'recoil';
import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TChatProject } from 'librechat-data-provider';
import type { ProjectAppearanceValue } from '../ProjectAppearance';
import ProjectEditDialog from '../ProjectEditDialog';
import ProjectAppearance from '../ProjectAppearance';
import ProjectIcon from '../ProjectIcon';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const project: TChatProject = {
  _id: '6650f0c2a1b2c3d4e5f60718',
  name: 'Garden',
  icon: 'leaf',
  color: 'green',
  conversationCount: 0,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
};

function Picker({ initial }: { initial: ProjectAppearanceValue }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <span id="icon-label">{'icon'}</span>
      <ProjectAppearance value={value} onChange={setValue} labelId="icon-label" />
      <output data-testid="value">{`${value.icon ?? '-'}/${value.color ?? '-'}`}</output>
    </>
  );
}

describe('ProjectAppearance', () => {
  it('marks folder and no color as chosen for a project without either', () => {
    render(<Picker initial={{ icon: null, color: null }} />);
    expect(screen.getByRole('radio', { name: 'com_ui_project_icon_folder' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'com_ui_project_color_none' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('picks an icon and a color by click and moves through colors with the arrow keys', () => {
    render(<Picker initial={{ icon: null, color: null }} />);
    fireEvent.click(screen.getByRole('radio', { name: 'com_ui_project_icon_rocket' }));
    fireEvent.click(screen.getByRole('radio', { name: 'com_ui_project_color_blue' }));
    expect(screen.getByTestId('value')).toHaveTextContent('rocket/blue');

    const blue = screen.getByRole('radio', { name: 'com_ui_project_color_blue' });
    blue.focus();
    fireEvent.keyDown(blue, { key: 'ArrowRight' });
    expect(screen.getByTestId('value')).toHaveTextContent('rocket/indigo');
    expect(screen.getByRole('radio', { name: 'com_ui_project_color_indigo' })).toHaveFocus();
  });
});

describe('ProjectIcon', () => {
  it('tints the icon with the project color and falls back to the neutral folder', () => {
    const { container, rerender } = render(<ProjectIcon project={project} />);
    expect(container.querySelector('svg')).toHaveStyle({ color: 'var(--project-green)' });
    expect(container.querySelector('svg')).toHaveClass('lucide-leaf');

    rerender(<ProjectIcon project={{ icon: null, color: null }} />);
    expect(container.querySelector('svg')).toHaveClass('lucide-folder', 'text-text-secondary');
  });
});

describe('ProjectEditDialog', () => {
  it('saves a changed icon and color with the project', async () => {
    const update = jest
      .spyOn(dataService, 'updateProject')
      .mockResolvedValue({ ...project, icon: 'star', color: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <RecoilRoot>
        <QueryClientProvider client={queryClient}>
          <ProjectEditDialog open onOpenChange={jest.fn()} project={project} />
        </QueryClientProvider>
      </RecoilRoot>,
    );

    const save = screen.getByRole('button', { name: 'com_ui_save' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'com_ui_project_icon_star' }));
    fireEvent.click(screen.getByRole('radio', { name: 'com_ui_project_color_none' }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: project._id, icon: 'star', color: null }),
      ),
    );
  });
});
