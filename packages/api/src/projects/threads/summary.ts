import { logger } from '@librechat/data-schemas';
import { extractEnvVariable } from 'librechat-data-provider';

/** The parts of a stored message the thread runner reads. */
export type ThreadMessage = {
  messageId: string;
  isCreatedByUser?: boolean;
  error?: boolean;
  text?: string | null;
  content?: unknown;
  createdAt?: Date | string;
};

export type ThreadSummaryRequest = {
  title: string;
  brief: string;
  reply: string;
  maxTokens: number;
  /** Set when the user talked to the thread directly: what they asked last. */
  followUp?: string;
  /** The hand-back the coordinator has now, which the new one replaces. */
  previous?: string;
};

export type ThreadSummarizer = (request: ThreadSummaryRequest) => Promise<string>;

/** An OpenAI-compatible chat endpoint the summary step can call. */
export type SummaryEndpoint = {
  baseURL: string;
  apiKey: string;
  model: string;
  /** llama-server: thinking is switched off through `chat_template_kwargs`. */
  llamaCpp: boolean;
};

const CHARS_PER_TOKEN = 4;
const REPLY_MAX_CHARS = 16_000;
const BRIEF_MAX_CHARS = 1_500;

type ContentPart = { type?: unknown; text?: unknown };

const partText = (part: ContentPart): string => {
  if (part?.type !== 'text') {
    return '';
  }
  if (typeof part.text === 'string') {
    return part.text;
  }
  const value = (part.text as { value?: unknown } | null | undefined)?.value;
  return typeof value === 'string' ? value : '';
};

/** The visible text of a message: its text parts, without thinking or tool calls. */
export function extractMessageText(message: ThreadMessage): string {
  if (Array.isArray(message.content) && message.content.length > 0) {
    const text = (message.content as ContentPart[]).map(partText).filter(Boolean).join('\n');
    if (text.trim()) {
      return text.trim();
    }
  }
  return (message.text ?? '').trim();
}

/** The last reply the thread's agent wrote. */
export function findFinalReply(messages: ThreadMessage[]): ThreadMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].isCreatedByUser !== true) {
      return messages[i];
    }
  }
  return undefined;
}

const stripThinking = (text: string): string =>
  text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '');

/** Cuts text to about `maxTokens`, at a word boundary. */
export function clampToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(1, maxTokens) * CHARS_PER_TOKEN;
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The summary when no model call is possible: the start of the thread's final reply. */
export function fallbackSummary({ reply, maxTokens }: ThreadSummaryRequest): string {
  return clampToTokens(reply, maxTokens);
}

/** The prompt of the summary step. Short, so the call costs little prefill. */
export function buildSummaryMessages({
  title,
  brief,
  reply,
  maxTokens,
  followUp,
  previous,
}: ThreadSummaryRequest): Array<{ role: 'system' | 'user'; content: string }> {
  const words = Math.max(30, Math.floor(maxTokens * 0.7));
  const earlier = previous
    ? `Earlier hand-back note:\n${previous.slice(0, BRIEF_MAX_CHARS)}\n\n`
    : '';
  const asked = followUp
    ? `The user then wrote in the thread:\n${followUp.slice(0, BRIEF_MAX_CHARS)}\n\n`
    : '';
  return [
    {
      role: 'system',
      content:
        'You write the hand-back note of a finished task thread for the project coordinator. ' +
        `In at most ${words} words, state the result: what was found or done, the key facts, ` +
        'numbers, names and links, and anything left open or needing the user. No preamble.',
    },
    {
      role: 'user',
      content:
        `Task: ${title}\n\nBrief:\n${brief.slice(0, BRIEF_MAX_CHARS)}\n\n${earlier}${asked}` +
        `Final answer of the thread:\n${reply.slice(0, REPLY_MAX_CHARS)}`,
    },
  ];
}

/**
 * A summarizer that calls an OpenAI-compatible `/chat/completions` endpoint with thinking off.
 * Falls back to the start of the reply when the endpoint is unknown or the call fails, so a
 * thread always finishes with something the coordinator can read.
 */
export function createThreadSummarizer({
  resolveEndpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120_000,
}: {
  resolveEndpoint: () => Promise<SummaryEndpoint | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ThreadSummarizer {
  return async (request) => {
    if (!request.reply.trim()) {
      return '';
    }
    try {
      const endpoint = await resolveEndpoint();
      if (!endpoint) {
        return fallbackSummary(request);
      }
      const response = await fetchImpl(`${endpoint.baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${endpoint.apiKey}`,
        },
        body: JSON.stringify({
          model: endpoint.model,
          messages: buildSummaryMessages(request),
          max_tokens: request.maxTokens,
          temperature: 0.2,
          stream: false,
          ...(endpoint.llamaCpp && { chat_template_kwargs: { enable_thinking: false } }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`summary request failed with ${response.status}`);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      const summary = typeof content === 'string' ? stripThinking(content).trim() : '';
      return summary ? clampToTokens(summary, request.maxTokens) : fallbackSummary(request);
    } catch (error) {
      logger.warn('[projects/threads] Summary step failed; using the start of the reply', error);
      return fallbackSummary(request);
    }
  };
}

type CustomEndpointConfig = {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  customParams?: { reasoningFormat?: string } | null;
};

/**
 * Finds the OpenAI-compatible endpoint an agent runs on among the configured custom endpoints.
 * Null for providers the summary step cannot call directly (they get the fallback summary).
 */
export function resolveCustomSummaryEndpoint(
  customEndpoints: CustomEndpointConfig[] | undefined,
  agent: { provider?: string | null; model?: string | null } | null | undefined,
): SummaryEndpoint | null {
  if (!agent?.provider || !agent.model) {
    return null;
  }
  const endpoint = customEndpoints?.find((entry) => entry.name === agent.provider);
  if (!endpoint?.baseURL) {
    return null;
  }
  const baseURL = extractEnvVariable(endpoint.baseURL);
  const apiKey = extractEnvVariable(endpoint.apiKey ?? '');
  if (!baseURL || baseURL.startsWith('${') || apiKey === 'user_provided') {
    return null;
  }
  return {
    baseURL,
    apiKey,
    model: agent.model,
    llamaCpp: endpoint.customParams?.reasoningFormat === 'llama_cpp_budget',
  };
}
