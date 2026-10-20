import { createToolPolicyHook } from '@librechat/agents';
import type { Agents, TToolApprovalPolicy } from 'librechat-data-provider';
import {
  mapToolApprovalPolicy,
  loadSessionApprovedTools,
  rememberSessionApprovals,
  resolveToolApprovalPolicy,
  collectSessionApprovedToolNames,
} from './policy';

/** The shape bennychat.yaml ships: read-only tools allowed, everything else asks. */
const endpoint: TToolApprovalPolicy = {
  enabled: true,
  mode: 'default',
  allow: ['search*_mcp_*', 'file_search'],
  deny: ['*_mcp_danger'],
};

const payload: Agents.ToolApprovalInterruptPayload = {
  type: 'tool_approval',
  action_requests: [
    { name: 'create_task_mcp_todo', arguments: {}, tool_call_id: 'call_1' },
    { name: 'send_mcp_mail', arguments: {}, tool_call_id: 'call_2' },
  ],
  review_configs: [
    { action_name: 'create_task_mcp_todo', tool_call_id: 'call_1', allowed_decisions: ['approve'] },
    { action_name: 'send_mcp_mail', tool_call_id: 'call_2', allowed_decisions: ['approve'] },
  ],
};

async function decide(policy: TToolApprovalPolicy | undefined, toolName: string) {
  const hook = createToolPolicyHook(mapToolApprovalPolicy(policy) ?? {});
  const result = await hook(
    { toolName } as Parameters<typeof hook>[0],
    new AbortController().signal,
  );
  return (result as { decision: string }).decision;
}

describe('always allow in this chat', () => {
  it('lets a remembered tool run without asking while other writes still ask', async () => {
    const policy = resolveToolApprovalPolicy({ endpoint, session: ['create_task_mcp_todo'] });
    expect(await decide(policy, 'create_task_mcp_todo')).toBe('allow');
    expect(await decide(policy, 'send_mcp_mail')).toBe('ask');
    expect(await decide(policy, 'search_mcp_websearch')).toBe('allow');
  });

  it('never overrides a deny rule and ignores glob-like names', async () => {
    const policy = resolveToolApprovalPolicy({
      endpoint,
      session: ['wipe_mcp_danger', '*'],
    });
    expect(await decide(policy, 'wipe_mcp_danger')).toBe('deny');
    expect(await decide(policy, 'send_mcp_mail')).toBe('ask');
  });

  it('leaves a disabled policy untouched', () => {
    const disabled: TToolApprovalPolicy = { enabled: false, allow: [] };
    expect(resolveToolApprovalPolicy({ endpoint: disabled, session: ['x'] })).toBe(disabled);
    expect(resolveToolApprovalPolicy({ endpoint: undefined, session: ['x'] })).toBeUndefined();
  });

  it('remembers only approvals scoped to the session, by the paused tool names', () => {
    const resolutions: Agents.ToolApprovalResolution[] = [
      { tool_call_id: 'call_1', decision: 'approve', scope: 'session' },
      { tool_call_id: 'call_2', decision: 'approve' },
      { tool_call_id: 'call_unknown', decision: 'approve', scope: 'session' },
    ];
    expect(collectSessionApprovedToolNames(payload, resolutions)).toEqual(['create_task_mcp_todo']);
    expect(
      collectSessionApprovedToolNames(payload, [
        { tool_call_id: 'call_1', decision: 'reject', scope: 'session' },
      ]),
    ).toEqual([]);
  });

  it('stores remembered names on resume and skips other pending actions', async () => {
    const add = jest.fn(async (_user: string, _convo: string, names: readonly string[]) => [
      ...names,
    ]);
    await rememberSessionApprovals({
      pendingAction: { payload },
      body: { decisions: [{ tool_call_id: 'call_2', decision: 'approve', scope: 'session' }] },
      userId: 'u1',
      conversationId: 'c1',
      addConversationApprovedTools: add,
    });
    expect(add).toHaveBeenCalledWith('u1', 'c1', ['send_mcp_mail']);

    add.mockClear();
    await rememberSessionApprovals({
      pendingAction: { payload: { type: 'ask_user_question' } },
      body: { decisions: [{ tool_call_id: 'call_2', decision: 'approve', scope: 'session' }] },
      userId: 'u1',
      conversationId: 'c1',
      addConversationApprovedTools: add,
    });
    await rememberSessionApprovals({
      pendingAction: { payload },
      body: { decisions: [{ tool_call_id: 'call_2', decision: 'approve' }] },
      userId: 'u1',
      conversationId: 'c1',
      addConversationApprovedTools: add,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('reads remembered names only when approvals can prompt', async () => {
    const read = jest.fn(async () => ['create_task_mcp_todo']);
    const args = { userId: 'u1', conversationId: 'c1', getConversationApprovedTools: read };
    expect(await loadSessionApprovedTools({ ...args, policy: endpoint })).toEqual([
      'create_task_mcp_todo',
    ]);
    expect(await loadSessionApprovedTools({ ...args, policy: { enabled: false } })).toEqual([]);
    expect(
      await loadSessionApprovedTools({ ...args, conversationId: null, policy: endpoint }),
    ).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);

    const failing = jest.fn(async () => {
      throw new Error('db down');
    });
    expect(
      await loadSessionApprovedTools({
        ...args,
        policy: endpoint,
        getConversationApprovedTools: failing,
      }),
    ).toEqual([]);
  });
});
