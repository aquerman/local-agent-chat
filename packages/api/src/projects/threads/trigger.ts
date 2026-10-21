import { PROJECT_THREAD_SOURCE } from './service';

type TriggerRequest = {
  _isAgentTrigger?: boolean;
  body?: Record<string, unknown>;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Whether a chat request is a project thread's run, sent by the trusted trigger host. The
 * trigger token is the trust boundary: an ordinary chat request that copies these body fields
 * is not an agent trigger and gets nothing from them.
 */
export function isProjectThreadFireRequest(req?: TriggerRequest): boolean {
  if (req?._isAgentTrigger !== true) {
    return false;
  }
  const trigger = record(req.body?.agentTrigger);
  const source = record(record(trigger?.event)?.source);
  return (
    trigger?.version === 1 &&
    source?.type === PROJECT_THREAD_SOURCE &&
    typeof source.id === 'string' &&
    source.id.length > 0
  );
}
