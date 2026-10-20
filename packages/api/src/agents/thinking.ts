import { isAgentsEndpoint, ReasoningParameterFormat } from 'librechat-data-provider';
import type { TEndpoint } from 'librechat-data-provider';

type RequestModelParameters = Record<string, unknown>;

/**
 * The request's model parameters that may layer over the initial agent's own.
 *
 * Ephemeral agents (any non-agents endpoint) are built from the request, so the request keeps
 * every parameter. A persisted agent owns its model settings, and the agents endpoint forwards
 * the conversation's `reasoning_effort` only so the thinking pill (docs/adr/0001) can reach an
 * agent whose provider is a `llama_cpp_budget` endpoint; for any other provider it is dropped,
 * so a stale conversation value never overrides the agent's configured effort.
 */
export function selectRequestModelParameters({
  requestEndpoint,
  requestParameters,
  customEndpointConfig,
}: {
  requestEndpoint?: string | null;
  requestParameters?: RequestModelParameters;
  customEndpointConfig?: Partial<TEndpoint>;
}): RequestModelParameters | undefined {
  if (requestParameters == null || !isAgentsEndpoint(requestEndpoint)) {
    return requestParameters;
  }
  if (!('reasoning_effort' in requestParameters)) {
    return requestParameters;
  }
  if (
    customEndpointConfig?.customParams?.reasoningFormat === ReasoningParameterFormat.llamaCppBudget
  ) {
    return requestParameters;
  }
  const { reasoning_effort: _dropped, ...rest } = requestParameters;
  return rest;
}

/**
 * The thinking-pill mode to store on an agents conversation, so a reloaded chat shows (and
 * sends) the mode it was using. Other endpoints already persist their model parameters.
 */
export function getAgentThinkingSaveOptions(
  endpoint: string | null | undefined,
  requestParameters: RequestModelParameters | undefined,
): { reasoning_effort?: string } {
  const effort = requestParameters?.reasoning_effort;
  if (!isAgentsEndpoint(endpoint) || typeof effort !== 'string' || effort === '') {
    return {};
  }
  return { reasoning_effort: effort };
}
