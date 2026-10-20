import {
  EModelEndpoint,
  ReasoningEffort,
  parseCompactConvo,
  ReasoningParameterFormat,
} from 'librechat-data-provider';
import type { TEndpoint } from 'librechat-data-provider';
import { getAgentThinkingSaveOptions, selectRequestModelParameters } from './thinking';

const llamaEndpoint: Partial<TEndpoint> = {
  name: 'Benner',
  customParams: {
    defaultParamsEndpoint: 'custom',
    reasoningFormat: ReasoningParameterFormat.llamaCppBudget,
  },
};
const plainEndpoint: Partial<TEndpoint> = {
  name: 'Other',
  customParams: { defaultParamsEndpoint: 'custom' },
};

describe('selectRequestModelParameters', () => {
  it('forwards the thinking pill to a saved agent on a llama_cpp_budget endpoint', () => {
    const requestParameters = { agent_id: 'agent_benny', reasoning_effort: ReasoningEffort.high };
    expect(
      selectRequestModelParameters({
        requestEndpoint: EModelEndpoint.agents,
        requestParameters,
        customEndpointConfig: llamaEndpoint,
      }),
    ).toEqual(requestParameters);
  });

  it('drops a conversation effort for a saved agent on any other provider', () => {
    expect(
      selectRequestModelParameters({
        requestEndpoint: EModelEndpoint.agents,
        requestParameters: { agent_id: 'agent_x', reasoning_effort: ReasoningEffort.low },
        customEndpointConfig: plainEndpoint,
      }),
    ).toEqual({ agent_id: 'agent_x' });
    expect(
      selectRequestModelParameters({
        requestEndpoint: EModelEndpoint.agents,
        requestParameters: { reasoning_effort: ReasoningEffort.low },
      }),
    ).toEqual({});
  });

  it('leaves ephemeral (non-agents endpoint) requests untouched', () => {
    const requestParameters = { model: 'gpt-x', reasoning_effort: ReasoningEffort.medium };
    expect(
      selectRequestModelParameters({
        requestEndpoint: EModelEndpoint.openAI,
        requestParameters,
        customEndpointConfig: plainEndpoint,
      }),
    ).toBe(requestParameters);
  });

  it('keeps the effort through the agents request parser that feeds it', () => {
    const parsed = parseCompactConvo({
      endpoint: EModelEndpoint.agents,
      conversation: { agent_id: 'agent_benny', reasoning_effort: ReasoningEffort.none },
    });
    expect(parsed).toMatchObject({ agent_id: 'agent_benny', reasoning_effort: 'none' });
  });
});

describe('getAgentThinkingSaveOptions', () => {
  it('stores the pill mode on agents conversations only', () => {
    expect(
      getAgentThinkingSaveOptions(EModelEndpoint.agents, {
        reasoning_effort: ReasoningEffort.high,
      }),
    ).toEqual({ reasoning_effort: 'high' });
    expect(getAgentThinkingSaveOptions(EModelEndpoint.agents, {})).toEqual({});
    expect(getAgentThinkingSaveOptions(EModelEndpoint.agents, undefined)).toEqual({});
    expect(
      getAgentThinkingSaveOptions(EModelEndpoint.openAI, { reasoning_effort: ReasoningEffort.low }),
    ).toEqual({});
  });
});
