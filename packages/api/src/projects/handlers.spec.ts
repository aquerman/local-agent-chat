import type { Response } from 'express';
import { createProjectHandlers } from './handlers';

type Deps = Parameters<typeof createProjectHandlers>[0];
type Handlers = ReturnType<typeof createProjectHandlers>;
type HandlerRequest = Parameters<Handlers['createProject']>[0];

const PROJECT_ID = '6650f0c2a1b2c3d4e5f60718';

function mockResponse() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function request(body: object, params: Record<string, string> = {}): HandlerRequest {
  return { body, params, query: {}, user: { id: 'user-1' } } as unknown as HandlerRequest;
}

function setup() {
  const createChatProject = jest.fn().mockResolvedValue({ _id: PROJECT_ID, name: 'Garden' });
  const updateChatProject = jest.fn().mockResolvedValue({ _id: PROJECT_ID, name: 'Garden' });
  const handlers = createProjectHandlers({
    createChatProject,
    updateChatProject,
  } as Partial<Deps> as Deps);
  return { handlers, createChatProject, updateChatProject };
}

describe('project handlers: icon and color', () => {
  it('passes a known icon and color through on create', async () => {
    const { handlers, createChatProject } = setup();
    const res = mockResponse();
    await handlers.createProject(
      request({ name: 'Garden', icon: 'leaf', color: 'green' }),
      res as unknown as Response,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(createChatProject).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'Garden', icon: 'leaf', color: 'green' }),
    );
  });

  it('rejects an unknown icon or color with 400', async () => {
    const { handlers, createChatProject, updateChatProject } = setup();
    const createRes = mockResponse();
    await handlers.createProject(
      request({ name: 'Garden', icon: 'skull' }),
      createRes as unknown as Response,
    );
    expect(createRes.status).toHaveBeenCalledWith(400);
    expect(createChatProject).not.toHaveBeenCalled();

    const updateRes = mockResponse();
    await handlers.updateProject(
      request({ color: '#ff0000' }, { projectId: PROJECT_ID }),
      updateRes as unknown as Response,
    );
    expect(updateRes.status).toHaveBeenCalledWith(400);
    expect(updateChatProject).not.toHaveBeenCalled();
  });

  it('clears the icon and color with null and leaves absent fields alone on update', async () => {
    const { handlers, updateChatProject } = setup();
    const res = mockResponse();
    await handlers.updateProject(
      request({ icon: null, color: null }, { projectId: PROJECT_ID }),
      res as unknown as Response,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateChatProject).toHaveBeenCalledWith('user-1', PROJECT_ID, {
      icon: null,
      color: null,
    });

    await handlers.updateProject(
      request({ name: 'Renamed' }, { projectId: PROJECT_ID }),
      mockResponse() as unknown as Response,
    );
    expect(updateChatProject).toHaveBeenLastCalledWith('user-1', PROJECT_ID, { name: 'Renamed' });
  });
});
