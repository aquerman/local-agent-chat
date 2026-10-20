# Thinking Mode Implementation Plan
Architecture: obsidian://open?vault=Main%20Vault&file=Notes%2FLocal%20LLM%20-%20Thinking%20Mode%20Architecture.md
Beads epic: local-agent-chat-dqr

> **For agentic workers:** Implement with `/implement` in a fresh session, task by task, test first (red → green) as each task's steps lay out. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flickering live-reasoning preview with a calm "Thinking…" → "Thought for Ns" indicator, and add an input-bar pill that sets how much the local model may think (Off / Low / Medium / High).

**Architecture:** The pill writes the conversation's existing `reasoning_effort`. A new reasoning format, `llama_cpp_budget`, enabled per custom endpoint in `librechat.yaml`, makes the backend translate that value into llama-server's own request fields (`chat_template_kwargs.enable_thinking`, `thinking_budget_tokens`); see ADR 0001. Rendering changes are client-only, in `Reasoning.tsx`.

**Tech Stack:** LibreChat fork (React + jotai/recoil + Ariakit client, TypeScript `packages/api`, `packages/data-provider`), Jest, llama.cpp `llama-server` b11149 with Qwen3.5-9B.

**Spec:** Decisions from the grilling session on 2026-10-14, recorded in `CONTEXT.md` (Thinking mode, Thinking budget, Thinking indicator) and `docs/adr/0001-thinking-mode-translated-in-librechat.md`. The decision list is reproduced under Global Constraints.

## Global Constraints

- Thinking modes are exactly: Off (`none`), Low (`low`), Medium (`medium`), High (`high`).
- Budgets: Low = 512, Medium = 2048, High = 6144 reasoning tokens, configured in `librechat.yaml` (`customParams.thinkingBudgets`), with these numbers as code defaults.
- Off is sent as `chat_template_kwargs: { enable_thinking: false }`; Low/Medium/High as `enable_thinking: true` + `thinking_budget_tokens: N`. Never send `reasoning_effort` to an endpoint using `llama_cpp_budget` (Qwen3.5 ignores it, verified 2026-10-14).
- Stored values outside the four: `unset`/`minimal` → Low, `xhigh`/`max` → High.
- The mode is per conversation; a new conversation starts from the mode last picked in this browser, and from Low before any pick.
- The pill appears only for endpoints whose `customParams.reasoningFormat` is `llama_cpp_budget` (today only `Benner`).
- The side-panel Reasoning Effort for that endpoint offers the same four values.
- Each request of a tool loop gets its own budget (no per-turn accounting).
- Title requests always send thinking off.
- When a budget runs out, llama-server injects a wrap-up message (`--reasoning-budget-message`).
- Reasoning text is never shown while it streams, whatever the "Show Thinking" setting. While streaming the row reads "Thinking..."; afterwards "Thought for Ns", click to expand the full text. Applies to both `Reasoning` and `ReasoningCompact` (inside tool-call groups).
- After a page reload the duration is unknown; the label falls back to the existing "Thoughts".
- Fork rules from `CLAUDE.md`: npm only, rebuild `packages/data-provider` before consumers (`npm run build:data-provider`), rebuild the client (`npm run build`) before manual testing via `scripts\start-chat.bat`.

## Review Focus

1. **A conversation saved with `reasoning_effort: 'max'` or `'minimal'`** (from the old side panel) must still send a valid budget, not an unknown level → test in Task 1.
2. **Reloading a finished chat** must show "Thoughts", never "Thought for 0s" or "Thought for NaNs" → test in Task 3.
3. **"Show Thinking" turned on** must not bring back live reasoning text while streaming → test in Task 3.
4. **A conversation on a non-llama endpoint** must not get a pill, and must not have `reasoning_effort` seeded into it → test in Task 4.
5. **Auto-title for a chat in High mode** must go out with thinking off and no budget → test in Task 2.

---

### Task 1: `llama_cpp_budget` reasoning format in the backend

**Files:**
- Modify: `packages/data-provider/src/schemas.ts:247-251` (enum)
- Modify: `packages/data-provider/src/config.ts:1683-1691` (customParams schema)
- Modify: `packages/api/src/endpoints/openai/llm.ts` (new `applyLlamaCppThinking`, `getOpenAILLMConfig` param + branch at ~line 920)
- Modify: `packages/api/src/endpoints/openai/config.ts:194-209` (pass `thinkingBudgets`)
- Test: `packages/api/src/endpoints/openai/llm.spec.ts`

**Interfaces:**
- Produces: `ReasoningParameterFormat.llamaCppBudget = 'llama_cpp_budget'`; type `TThinkingBudgets = { low: number; medium: number; high: number }` exported from `librechat-data-provider`; `customParams.thinkingBudgets?: TThinkingBudgets`; `export const DEFAULT_THINKING_BUDGETS: TThinkingBudgets` and `export function applyLlamaCppThinking(args: { reasoningEffort?: string | null; thinkingBudgets?: TThinkingBudgets; modelKwargs: Record<string, unknown> }): boolean` from `packages/api/src/endpoints/openai/llm.ts`.

- [ ] **Step 1: Write the failing tests** (append to `llm.spec.ts`; import `ReasoningEffort`, `ReasoningParameterFormat` from `librechat-data-provider` and `getOpenAILLMConfig` as the file already does)

```ts
describe('llama_cpp_budget reasoning format', () => {
  const base = {
    apiKey: 'Benner',
    streaming: true,
    endpoint: 'Benner',
    baseURL: 'http://127.0.0.1:8080/v1',
    reasoningFormat: ReasoningParameterFormat.llamaCppBudget,
  };

  it('turns Off into enable_thinking false with no budget', () => {
    const { llmConfig } = getOpenAILLMConfig({
      ...base,
      modelOptions: { model: 'local', reasoning_effort: ReasoningEffort.none },
    });
    expect(llmConfig.modelKwargs).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(llmConfig).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    [ReasoningEffort.low, 512],
    [ReasoningEffort.medium, 2048],
    [ReasoningEffort.high, 6144],
    [ReasoningEffort.unset, 512],
    [ReasoningEffort.minimal, 512],
    [ReasoningEffort.xhigh, 6144],
    [ReasoningEffort.max, 6144],
  ])('maps %s to a %i-token budget', (effort, budget) => {
    const { llmConfig } = getOpenAILLMConfig({
      ...base,
      modelOptions: { model: 'local', reasoning_effort: effort },
    });
    expect(llmConfig.modelKwargs).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      thinking_budget_tokens: budget,
    });
    expect(llmConfig.modelKwargs).not.toHaveProperty('reasoning_effort');
  });

  it('applies a budget even when no effort was ever chosen', () => {
    const { llmConfig } = getOpenAILLMConfig({ ...base, modelOptions: { model: 'local' } });
    expect(llmConfig.modelKwargs).toMatchObject({ thinking_budget_tokens: 512 });
  });

  it('uses configured budgets over the defaults', () => {
    const { llmConfig } = getOpenAILLMConfig({
      ...base,
      thinkingBudgets: { low: 100, medium: 200, high: 300 },
      modelOptions: { model: 'local', reasoning_effort: ReasoningEffort.medium },
    });
    expect(llmConfig.modelKwargs).toMatchObject({ thinking_budget_tokens: 200 });
  });

  it('keeps other chat_template_kwargs from addParams', () => {
    const { llmConfig } = getOpenAILLMConfig({
      ...base,
      addParams: { chat_template_kwargs: { foo: 'bar' } },
      modelOptions: { model: 'local', reasoning_effort: ReasoningEffort.none },
    });
    expect(llmConfig.modelKwargs).toEqual({
      chat_template_kwargs: { foo: 'bar', enable_thinking: false },
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/api && npx jest src/endpoints/openai/llm.spec.ts -t "llama_cpp_budget"`
Expected: FAIL (TypeScript error: `llamaCppBudget` does not exist on `ReasoningParameterFormat`).

- [ ] **Step 3: Add the enum value and schema field**

`packages/data-provider/src/schemas.ts`:

```ts
export enum ReasoningParameterFormat {
  disabled = 'disabled',
  reasoningEffort = 'reasoning_effort',
  reasoningObject = 'reasoning_object',
  /** llama.cpp `llama-server`: effort is sent as `chat_template_kwargs.enable_thinking`
   *  plus `thinking_budget_tokens`, because chat templates such as Qwen3.5's ignore
   *  `reasoning_effort`. See docs/adr/0001-thinking-mode-translated-in-librechat.md. */
  llamaCppBudget = 'llama_cpp_budget',
}
```

`packages/data-provider/src/config.ts`, above the custom endpoint schema:

```ts
/** Reasoning-token budgets per thinking mode, for `reasoningFormat: 'llama_cpp_budget'`. */
export const thinkingBudgetsSchema = z
  .object({
    low: z.number().int().positive(),
    medium: z.number().int().positive(),
    high: z.number().int().positive(),
  })
  .strict();
export type TThinkingBudgets = z.infer<typeof thinkingBudgetsSchema>;
```

and inside `customParams: z.object({ ... })` add after `reasoningKey`:

```ts
        /** Budgets used when `reasoningFormat` is `llama_cpp_budget`. */
        thinkingBudgets: thinkingBudgetsSchema.optional(),
```

Run: `npm run build:data-provider`

- [ ] **Step 4: Implement the translation in `llm.ts`**

Add `ReasoningEffort` to the `librechat-data-provider` import if missing, plus `import type { TThinkingBudgets } from 'librechat-data-provider';`. Add near `applyReasoningConfig`:

```ts
export const DEFAULT_THINKING_BUDGETS: TThinkingBudgets = { low: 512, medium: 2048, high: 6144 };

/** Folds stored efforts outside Off/Low/Medium/High onto the nearest mode. */
function toBudgetLevel(effort?: string | null): keyof TThinkingBudgets {
  if (effort === ReasoningEffort.medium) {
    return 'medium';
  }
  if (
    effort === ReasoningEffort.high ||
    effort === ReasoningEffort.xhigh ||
    effort === ReasoningEffort.max
  ) {
    return 'high';
  }
  return 'low';
}

/**
 * llama-server's per-request thinking switches. Unlike the other formats this one
 * always writes something: an unset effort means Low, because an uncapped Qwen3.5
 * can spend the whole reply allowance thinking and never answer.
 */
export function applyLlamaCppThinking({
  reasoningEffort,
  thinkingBudgets = DEFAULT_THINKING_BUDGETS,
  modelKwargs,
}: {
  reasoningEffort?: string | null;
  thinkingBudgets?: TThinkingBudgets;
  modelKwargs: Record<string, unknown>;
}): boolean {
  const inherited = modelKwargs.chat_template_kwargs;
  const templateKwargs =
    inherited != null && typeof inherited === 'object' && !Array.isArray(inherited)
      ? (inherited as Record<string, unknown>)
      : {};
  delete modelKwargs.reasoning_effort;

  if (reasoningEffort === ReasoningEffort.none) {
    modelKwargs.chat_template_kwargs = { ...templateKwargs, enable_thinking: false };
    delete modelKwargs.thinking_budget_tokens;
    return true;
  }

  modelKwargs.chat_template_kwargs = { ...templateKwargs, enable_thinking: true };
  modelKwargs.thinking_budget_tokens = thinkingBudgets[toBudgetLevel(reasoningEffort)];
  return true;
}
```

In `getOpenAILLMConfig`, add `thinkingBudgets` to the destructured params and the param type (`thinkingBudgets?: TThinkingBudgets;`), then replace

```ts
  if (!useOpenRouter) {
    hasModelKwargs =
      applyReasoningConfig({
```

with

```ts
  if (reasoningFormat === ReasoningParameterFormat.llamaCppBudget) {
    hasModelKwargs =
      applyLlamaCppThinking({ reasoningEffort, thinkingBudgets, modelKwargs }) || hasModelKwargs;
  } else if (!useOpenRouter) {
    hasModelKwargs =
      applyReasoningConfig({
```

(the rest of that block is unchanged).

In `packages/api/src/endpoints/openai/config.ts`, in the `getOpenAILLMConfig({ ... })` call (~line 194), add:

```ts
      thinkingBudgets: options.customParams?.thinkingBudgets,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/api && npx jest src/endpoints/openai/llm.spec.ts src/endpoints/openai/config.spec.ts`
Expected: PASS, including the existing tests.

- [ ] **Step 6: Typecheck and commit**

```bash
cd packages/api && npx tsc --noEmit -p .
git add packages/data-provider/src/schemas.ts packages/data-provider/src/config.ts packages/api/src/endpoints/openai/llm.ts packages/api/src/endpoints/openai/config.ts packages/api/src/endpoints/openai/llm.spec.ts
git commit -m "Add llama_cpp_budget reasoning format for llama-server thinking budgets"
```

---

### Task 2: Title requests never think

**Files:**
- Modify: `packages/api/src/agents/client.ts` (new `disableThinkingForTitle`, next to `omitTitleOptions` at line 23)
- Modify: `api/server/controllers/agents/client.js` (~line 6083, right after the `omitTitleOptions` filter)
- Test: `packages/api/src/agents/client.spec.ts`

**Interfaces:**
- Consumes: the `modelKwargs` shape written by Task 1 (`thinking_budget_tokens`, `chat_template_kwargs`).
- Produces: `export function disableThinkingForTitle<T extends { modelKwargs?: Record<string, unknown> }>(options: T): T`, exported from `@librechat/api` the same way `omitTitleOptions` is.

- [ ] **Step 1: Write the failing test** (append to `client.spec.ts`)

```ts
import { disableThinkingForTitle } from './client';

describe('disableThinkingForTitle', () => {
  it('turns a llama.cpp thinking budget into thinking off', () => {
    const result = disableThinkingForTitle({
      model: 'local',
      modelKwargs: {
        chat_template_kwargs: { enable_thinking: true, foo: 'bar' },
        thinking_budget_tokens: 6144,
        top_k: 20,
      },
    });
    expect(result.modelKwargs).toEqual({
      chat_template_kwargs: { enable_thinking: false, foo: 'bar' },
      top_k: 20,
    });
  });

  it('leaves options without a thinking budget untouched', () => {
    const options = { model: 'gpt-x', modelKwargs: { verbosity: 'low' } };
    expect(disableThinkingForTitle(options)).toBe(options);
    const bare = { model: 'gpt-x' };
    expect(disableThinkingForTitle(bare)).toBe(bare);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/api && npx jest src/agents/client.spec.ts -t disableThinkingForTitle`
Expected: FAIL (`disableThinkingForTitle` is not exported).

- [ ] **Step 3: Implement**

In `packages/api/src/agents/client.ts`, after `omitTitleOptions`:

```ts
/**
 * Title requests never think. With `reasoningFormat: 'llama_cpp_budget'` the
 * conversation's budget rides along in `modelKwargs`; left on, a reasoning model
 * can spend the title's whole allowance thinking and return no title. A
 * `thinking_budget_tokens` key is the marker that this format is active.
 */
export function disableThinkingForTitle<T extends { modelKwargs?: Record<string, unknown> }>(
  options: T,
): T {
  const kwargs = options.modelKwargs;
  if (kwargs?.thinking_budget_tokens == null) {
    return options;
  }
  const { thinking_budget_tokens: _budget, chat_template_kwargs, ...rest } = kwargs;
  const templateKwargs =
    chat_template_kwargs != null && typeof chat_template_kwargs === 'object'
      ? (chat_template_kwargs as Record<string, unknown>)
      : {};
  return {
    ...options,
    modelKwargs: { ...rest, chat_template_kwargs: { ...templateKwargs, enable_thinking: false } },
  };
}
```

Make sure it is re-exported wherever `omitTitleOptions` is (check `packages/api/src/agents/index.ts`). In `api/server/controllers/agents/client.js`, add `disableThinkingForTitle` to the `@librechat/api` import that already brings in `omitTitleOptions` (line 18), and immediately after the block that ends with

```js
    if (anthropicClientOptions?.defaultHeaders != null && clientOptions.clientOptions == null) {
      clientOptions.clientOptions = anthropicClientOptions;
    }
```

add:

```js
    clientOptions = disableThinkingForTitle(clientOptions);
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/api && npx jest src/agents/client.spec.ts` then `npm run build:api` and `cd api && npx jest server/controllers/agents --silent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/agents/client.ts packages/api/src/agents/client.spec.ts packages/api/src/agents/index.ts api/server/controllers/agents/client.js
git commit -m "Send title requests with thinking off for llama.cpp budgets"
```

---

### Task 3: Thinking indicator replaces the live peek

**Files:**
- Create: `client/src/hooks/Messages/useThinkingDuration.ts`
- Create: `client/src/hooks/Messages/__tests__/useThinkingDuration.test.ts`
- Modify: `client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx` (delete `lastSentences`, `PEEK_*`, `StreamingThoughtPeek`; change labels and expansion in `Reasoning` and `ReasoningCompact`)
- Modify: `client/src/locales/en/translation.json` (add `com_ui_thought_for`)
- Test: `client/src/components/Chat/Messages/Content/Parts/__tests__/Reasoning.test.tsx` (create)

**Interfaces:**
- Produces: `export default function useThinkingDuration(key: string, isThinking: boolean): number | null` (whole seconds, at least 1; `null` when the start was not observed in this page load).
- Consumes: `useMessageContext()` → `{ messageId, isSubmitting, isLatestMessage, nextType }` (already used in `Reasoning`).

- [ ] **Step 1: Write the failing hook test**

```ts
import { renderHook, act } from '@testing-library/react';
import useThinkingDuration from '../useThinkingDuration';

describe('useThinkingDuration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports whole seconds once thinking stops', () => {
    jest.setSystemTime(new Date('2026-10-14T10:00:00Z'));
    const { result, rerender } = renderHook(
      ({ thinking }) => useThinkingDuration('msg-1:0', thinking),
      { initialProps: { thinking: true } },
    );
    expect(result.current).toBeNull();
    act(() => {
      jest.setSystemTime(new Date('2026-10-14T10:00:12.400Z'));
    });
    rerender({ thinking: false });
    expect(result.current).toBe(12);
  });

  it('never reports 0 seconds', () => {
    const { result, rerender } = renderHook(
      ({ thinking }) => useThinkingDuration('msg-2:0', thinking),
      { initialProps: { thinking: true } },
    );
    rerender({ thinking: false });
    expect(result.current).toBe(1);
  });

  it('returns null for a thought it never saw start (page reload)', () => {
    const { result } = renderHook(() => useThinkingDuration('msg-3:0', false));
    expect(result.current).toBeNull();
  });

  it('survives a remount with the same key', () => {
    const first = renderHook(({ thinking }) => useThinkingDuration('msg-4:0', thinking), {
      initialProps: { thinking: true },
    });
    first.rerender({ thinking: false });
    const value = first.result.current;
    first.unmount();
    const second = renderHook(() => useThinkingDuration('msg-4:0', false));
    expect(second.result.current).toBe(value);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx jest src/hooks/Messages/__tests__/useThinkingDuration.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

```ts
import { useEffect, useReducer } from 'react';

type Span = { start: number; end?: number };

/** Module-level so a reasoning row that remounts mid-stream (grouping changes,
 *  virtualised lists) keeps its timing. One entry per thought seen in this page
 *  load; small enough to never need eviction. */
const spans = new Map<string, Span>();

/**
 * Seconds a reasoning part spent thinking, measured in this browser while it
 * streamed. Durations are not persisted, so after a reload this returns `null`
 * and the caller falls back to a plain label.
 */
export default function useThinkingDuration(key: string, isThinking: boolean): number | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const span = spans.get(key);
    if (isThinking) {
      if (span == null) {
        spans.set(key, { start: Date.now() });
      }
      return;
    }
    if (span != null && span.end == null) {
      span.end = Date.now();
      rerender();
    }
  }, [key, isThinking]);

  const span = spans.get(key);
  if (span?.end == null) {
    return null;
  }
  return Math.max(1, Math.round((span.end - span.start) / 1000));
}
```

Note: the "never reports 0" and "12 s" tests rely on the effect running in the same `rerender` act; if the first assertion after `rerender` sees `null`, wrap `rerender` in `act` — the hook calls `rerender()` from its effect, which React flushes inside `act`.

- [ ] **Step 4: Run the hook test**

Run: `cd client && npx jest src/hooks/Messages/__tests__/useThinkingDuration.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

Model the mocks on an existing test in `Parts/__tests__/` (e.g. `CollapsibleText.test.tsx`) for the providers it wraps with (RecoilRoot / jotai). The assertions:

```tsx
import { render, screen } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { showThinkingAtom } from '~/store/showThinking';
import Reasoning from '../Reasoning';

const messageContext = {
  messageId: 'msg-r',
  isSubmitting: true,
  isLatestMessage: true,
  nextType: undefined,
};
jest.mock('~/Providers', () => ({
  ...jest.requireActual('~/Providers'),
  useMessageContext: () => messageContext,
}));
jest.mock('~/hooks', () => ({
  ...jest.requireActual('~/hooks'),
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

const renderWith = (showThinking: boolean) => {
  const store = createStore();
  store.set(showThinkingAtom, showThinking);
  return render(
    <JotaiProvider store={store}>
      <Reasoning reasoning="<think>secret chain of thought</think>" isLast partKeyIndex={0} />
    </JotaiProvider>,
  );
};

describe('Reasoning thinking indicator', () => {
  it('shows only the Thinking label while streaming', () => {
    renderWith(false);
    expect(screen.getByText('com_ui_thinking')).toBeInTheDocument();
    expect(screen.queryByText(/secret chain of thought/)).not.toBeInTheDocument();
  });

  it('hides live text even when Show Thinking is on', () => {
    renderWith(true);
    expect(screen.queryByText(/secret chain of thought/)).not.toBeInTheDocument();
  });

  it('falls back to Thoughts for a finished thought it never saw stream', () => {
    messageContext.isSubmitting = false;
    renderWith(false);
    expect(screen.getByText('com_ui_thoughts')).toBeInTheDocument();
    messageContext.isSubmitting = true;
  });
});
```

Run: `cd client && npx jest src/components/Chat/Messages/Content/Parts/__tests__/Reasoning.test.tsx`
Expected: FAIL on the "Show Thinking is on" case (text currently renders expanded while streaming).

- [ ] **Step 6: Change `Reasoning.tsx`**

1. Delete `PEEK_SENTENCES`, `lastSentences`, `PEEK_FADE`, `StreamingThoughtPeek` and both `<StreamingThoughtPeek …/>` usages. Drop now-unused imports (`useEffect`, `fontSizeAtom` only if `ReasoningCompact` no longer uses it — it still does, keep it).
2. Add `import useThinkingDuration from '~/hooks/Messages/useThinkingDuration';`.
3. In `Reasoning`:

```tsx
  const { messageId, isSubmitting, isLatestMessage, nextType } = useMessageContext();
  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;
  /** Reasoning text is never shown live: while a thought streams the row is
   *  only a "Thinking..." label, which removes the per-token reflow the old
   *  peek caused. The user's expand choice applies once thinking ends. */
  const isThinking = effectiveIsSubmitting && isLast;
  const seconds = useThinkingDuration(`${messageId}:${partKeyIndex}`, isThinking);
  const isExpanded = !isThinking && (expansionOverride ?? defaultExpanded);
```

(move the existing `useMessageContext` line up so `isThinking` is defined before `useExpandCollapse(isExpanded)`), and replace the `label` memo with:

```tsx
  const label = useMemo(() => {
    const generated = reasoningLabel?.trim();
    if (generated) {
      return generated;
    }
    if (isThinking) {
      return localize('com_ui_thinking');
    }
    return seconds != null
      ? localize('com_ui_thought_for', { 0: String(seconds) })
      : localize('com_ui_thoughts');
  }, [isThinking, localize, reasoningLabel, seconds]);
```

Pass `animate={false}` to `ThinkingContent` (the body only renders after thinking ends, so word fade-in has nothing to animate).

4. In `ReasoningCompact`:

```tsx
    const { messageId } = useMessageContext();
    const seconds = useThinkingDuration(`${messageId}:${partKeyIndex}`, isStreaming);
    const isExpanded = !isStreaming && (expansionOverride ?? defaultExpanded);
    const displayLabel =
      !isStreaming && seconds != null && label === localize('com_ui_thoughts')
        ? localize('com_ui_thought_for', { 0: String(seconds) })
        : label;
```

and use `displayLabel` wherever `label` is rendered (`<span className="tool-status-text …">` and `aria-label`). Add `import { useMessageContext } from '~/Providers';` if not already imported in that component's scope (it is imported at the top of the file).

5. `client/src/locales/en/translation.json`, next to `com_ui_thoughts`:

```json
  "com_ui_thought_for": "Thought for {{0}}s",
```

- [ ] **Step 7: Run the tests**

Run: `cd client && npx jest src/components/Chat/Messages/Content src/hooks/Messages`
Expected: PASS, including existing tests that reference the peek — update any that assert on `StreamingThoughtPeek` by asserting the label instead.

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/Messages/useThinkingDuration.ts client/src/hooks/Messages/__tests__/useThinkingDuration.test.ts client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx client/src/components/Chat/Messages/Content/Parts/__tests__/Reasoning.test.tsx client/src/locales/en/translation.json
git commit -m "Show a Thinking indicator instead of streaming reasoning text"
```

---

### Task 4: Thinking mode pill in the input bar

**Files:**
- Modify: `packages/data-provider/src/config.ts:4480` (add `LAST_THINKING_MODE` to `LocalStorageKeys`)
- Create: `client/src/hooks/Input/thinkingModePreference.ts`
- Create: `client/src/components/Chat/Input/ThinkingModeMenu.tsx`
- Modify: `client/src/components/Chat/Input/ChatForm.tsx:869` (render it next to `CodeApprovalMenu`)
- Modify: `client/src/locales/en/translation.json`
- Test: `client/src/components/Chat/Input/__tests__/ThinkingModeMenu.spec.tsx`

**Interfaces:**
- Consumes: `ReasoningParameterFormat.llamaCppBudget` (Task 1); `useGetEndpointsQuery` from `~/data-provider`; `createStorageAtom` from `~/store/jotai-utils`.
- Produces: `export const THINKING_MODES = ['none', 'low', 'medium', 'high'] as const; export type ThinkingMode = (typeof THINKING_MODES)[number];` and `useThinkingModePreference(): { get(): ThinkingMode | undefined; remember(mode: ThinkingMode): void }` from `thinkingModePreference.ts`; default export `ThinkingModeMenu({ conversation, setConversation, disabled })`.

- [ ] **Step 1: Write the failing test**

Mirror the setup of `__tests__/CodeApprovalMenu.spec.tsx` (providers, `useLocalize` mock, query client). Mock `~/data-provider`:

```tsx
const endpointsConfig = {
  Benner: { type: 'custom', customParams: { reasoningFormat: 'llama_cpp_budget' } },
  OtherCustom: { type: 'custom', customParams: {} },
};
jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetEndpointsQuery: () => ({ data: endpointsConfig }),
}));
```

Cases:

```tsx
it('is hidden for an endpoint without llama_cpp_budget and seeds nothing', () => {
  const setConversation = jest.fn();
  renderMenu({ conversation: { conversationId: 'c1', endpoint: 'OtherCustom' }, setConversation });
  expect(screen.queryByTestId('thinking-mode')).not.toBeInTheDocument();
  expect(setConversation).not.toHaveBeenCalled();
});

it('seeds a new Benner conversation with Low when nothing was picked before', () => {
  const setConversation = jest.fn();
  renderMenu({ conversation: { conversationId: 'new', endpoint: 'Benner' }, setConversation });
  const update = setConversation.mock.calls[0][0];
  expect(update({ conversationId: 'new', endpoint: 'Benner' })).toMatchObject({
    reasoning_effort: 'low',
  });
});

it('seeds from the last pick in this browser', () => {
  localStorage.setItem('lastThinkingMode', JSON.stringify('high'));
  const setConversation = jest.fn();
  renderMenu({ conversation: { conversationId: 'new', endpoint: 'Benner' }, setConversation });
  expect(setConversation.mock.calls[0][0]({ endpoint: 'Benner' })).toMatchObject({
    reasoning_effort: 'high',
  });
});

it('shows the stored mode and does not reseed it', () => {
  const setConversation = jest.fn();
  renderMenu({
    conversation: { conversationId: 'c2', endpoint: 'Benner', reasoning_effort: 'medium' },
    setConversation,
  });
  expect(screen.getByTestId('thinking-mode')).toHaveTextContent('com_ui_thinking_mode_medium');
  expect(setConversation).not.toHaveBeenCalled();
});

it('picking Off writes none and remembers it', async () => {
  const setConversation = jest.fn();
  renderMenu({
    conversation: { conversationId: 'c3', endpoint: 'Benner', reasoning_effort: 'low' },
    setConversation,
  });
  await userEvent.click(screen.getByTestId('thinking-mode'));
  await userEvent.click(screen.getByText('com_ui_thinking_mode_none'));
  expect(setConversation.mock.calls.at(-1)[0]({ reasoning_effort: 'low' })).toMatchObject({
    reasoning_effort: 'none',
  });
  expect(JSON.parse(localStorage.getItem('lastThinkingMode') ?? 'null')).toBe('none');
});
```

Run: `cd client && npx jest src/components/Chat/Input/__tests__/ThinkingModeMenu.spec.tsx`
Expected: FAIL (module not found).

- [ ] **Step 2: Storage key and preference hook**

`packages/data-provider/src/config.ts`, in `LocalStorageKeys` after `LAST_CODE_APPROVAL_MODE`:

```ts
  /** Last thinking mode picked, used to seed new conversations on llama_cpp_budget endpoints */
  LAST_THINKING_MODE = 'lastThinkingMode',
```

Run `npm run build:data-provider`. Then `client/src/hooks/Input/thinkingModePreference.ts`:

```ts
import { useAtom } from 'jotai';
import { LocalStorageKeys } from 'librechat-data-provider';
import { createStorageAtom } from '~/store/jotai-utils';

export const THINKING_MODES = ['none', 'low', 'medium', 'high'] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return (THINKING_MODES as readonly unknown[]).includes(value);
}

const preference = createStorageAtom<string | null>(LocalStorageKeys.LAST_THINKING_MODE, null);

/** The thinking mode last picked in this browser, so a new chat opens the way
 *  the last one was left. A hint only; an invalid saved value reads as unset. */
export function useThinkingModePreference() {
  const [saved, setSaved] = useAtom(preference);
  return {
    get: (): ThinkingMode | undefined => (isThinkingMode(saved) ? saved : undefined),
    remember: (mode: ThinkingMode) => {
      try {
        setSaved(mode);
      } catch {
        // Disabled or full browser storage must not block an explicit pick.
      }
    },
  };
}
```

- [ ] **Step 3: The menu component**

`client/src/components/Chat/Input/ThinkingModeMenu.tsx` — follows `CodeApprovalMenu.tsx` (same Ariakit menu, `composerControlClasses`, popover classes; copy its `Ariakit.Menu` className block and item markup verbatim, swapping data):

```tsx
import { useEffect } from 'react';
import * as Ariakit from '@ariakit/react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Lightbulb, LightbulbOff } from 'lucide-react';
import { Constants, QueryKeys, ReasoningParameterFormat } from 'librechat-data-provider';
import { TooltipAnchor, composerControlClasses } from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import type { ThinkingMode } from '~/hooks/Input/thinkingModePreference';
import {
  THINKING_MODES,
  isThinkingMode,
  useThinkingModePreference,
} from '~/hooks/Input/thinkingModePreference';
import { useGetEndpointsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const modeOptions: Record<
  ThinkingMode,
  { icon: LucideIcon; label: TranslationKeys; description: TranslationKeys }
> = {
  none: {
    icon: LightbulbOff,
    label: 'com_ui_thinking_mode_none',
    description: 'com_ui_thinking_mode_none_description',
  },
  low: {
    icon: Lightbulb,
    label: 'com_ui_thinking_mode_low',
    description: 'com_ui_thinking_mode_low_description',
  },
  medium: {
    icon: Lightbulb,
    label: 'com_ui_thinking_mode_medium',
    description: 'com_ui_thinking_mode_medium_description',
  },
  high: {
    icon: Lightbulb,
    label: 'com_ui_thinking_mode_high',
    description: 'com_ui_thinking_mode_high_description',
  },
};

/** Stored efforts outside the four modes, from before this menu existed. */
function toMode(effort: unknown): ThinkingMode | undefined {
  if (isThinkingMode(effort)) {
    return effort;
  }
  if (effort === 'xhigh' || effort === 'max') {
    return 'high';
  }
  if (effort === 'minimal') {
    return 'low';
  }
  return undefined;
}

export default function ThinkingModeMenu({
  conversation,
  setConversation,
  disabled,
}: {
  conversation: TConversation | null;
  setConversation: SetterOrUpdater<TConversation | null>;
  disabled: boolean;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const preference = useThinkingModePreference();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const menuStore = Ariakit.useMenuStore({ focusLoop: true, placement: 'top-start' });
  const isOpen = menuStore.useState('open');

  const endpoint = conversation?.endpoint ?? '';
  const available =
    endpointsConfig?.[endpoint]?.customParams?.reasoningFormat ===
    ReasoningParameterFormat.llamaCppBudget;
  const stored = toMode(conversation?.reasoning_effort);
  const selected: ThinkingMode = stored ?? preference.get() ?? 'low';

  /** A conversation with no mode yet starts from the last pick. Writing it into
   *  the conversation (not just displaying it) is what makes the backend send
   *  the same mode the pill shows. */
  useEffect(() => {
    if (!available || stored != null || conversation == null) {
      return;
    }
    setConversation((current) =>
      current == null ? current : { ...current, reasoning_effort: selected },
    );
  }, [available, stored, selected, conversation, setConversation]);

  if (!available) {
    return null;
  }

  const selectMode = (mode: ThinkingMode) => {
    preference.remember(mode);
    setConversation((current) =>
      current == null ? current : { ...current, reasoning_effort: mode },
    );
    const conversationId = conversation?.conversationId;
    if (conversation == null || conversationId == null || conversationId === Constants.NEW_CONVO) {
      return;
    }
    queryClient.setQueryData<TConversation>([QueryKeys.conversation, conversationId], (cached) => ({
      ...(cached ?? conversation),
      reasoning_effort: mode,
    }));
  };

  const SelectedIcon = modeOptions[selected].icon;

  return (
    <Ariakit.MenuProvider store={menuStore}>
      <TooltipAnchor
        description={localize('com_ui_thinking_mode')}
        disabled={isOpen}
        render={
          <Ariakit.MenuButton
            disabled={disabled}
            data-testid="thinking-mode"
            aria-label={`${localize('com_ui_thinking_mode')}: ${localize(modeOptions[selected].label)}`}
            className={cn(
              composerControlClasses(),
              'min-w-0 max-w-full px-2.5 md:px-theme-normal',
              isOpen && 'bg-surface-hover',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          />
        }
      >
        <SelectedIcon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 max-w-[12rem] truncate">
          {localize(modeOptions[selected].label)}
        </span>
        <ChevronDown
          className={cn('size-3 shrink-0 text-text-secondary transition-transform', isOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </TooltipAnchor>
      {/* Ariakit.Menu + MenuHeading + one MenuItem per THINKING_MODES entry:
          copy the markup from CodeApprovalMenu.tsx (lines ~135-200), with
          onClick={() => selectMode(mode)}, the mode's icon/label/description,
          and a <Check /> on the selected one. */}
    </Ariakit.MenuProvider>
  );
}
```

The one comment block above is the only part to transcribe from `CodeApprovalMenu.tsx`. Copy it exactly, iterating `THINKING_MODES.map((mode) => …)`, so the two menus look the same.

- [ ] **Step 4: Render it and add strings**

`ChatForm.tsx`, import `ThinkingModeMenu from './ThinkingModeMenu';` and render right before `<CodeApprovalMenu`:

```tsx
                <ThinkingModeMenu
                  conversation={conversation}
                  setConversation={setConversation}
                  disabled={disableInputs}
                />
```

`translation.json`:

```json
  "com_ui_thinking_mode": "Thinking mode",
  "com_ui_thinking_mode_none": "Off",
  "com_ui_thinking_mode_none_description": "Answers straight away",
  "com_ui_thinking_mode_low": "Low",
  "com_ui_thinking_mode_low_description": "Thinks briefly before answering",
  "com_ui_thinking_mode_medium": "Medium",
  "com_ui_thinking_mode_medium_description": "Thinks for a while",
  "com_ui_thinking_mode_high": "High",
  "com_ui_thinking_mode_high_description": "Thinks longest, for hard problems",
```

- [ ] **Step 5: Run the tests**

Run: `cd client && npx jest src/components/Chat/Input`
Expected: PASS (new spec plus the existing `ChatForm.*` specs).

- [ ] **Step 6: Commit**

```bash
git add packages/data-provider/src/config.ts client/src/hooks/Input/thinkingModePreference.ts client/src/components/Chat/Input/ThinkingModeMenu.tsx client/src/components/Chat/Input/ChatForm.tsx client/src/components/Chat/Input/__tests__/ThinkingModeMenu.spec.tsx client/src/locales/en/translation.json
git commit -m "Add thinking mode pill to the input bar for llama.cpp endpoints"
```

---

### Task 5: Wire it up for Benner and verify end to end

**Files:**
- Modify: `librechat.yaml` (git-ignored; Benner `customParams`)
- Modify: `CLAUDE.md` (fork section: one paragraph on thinking mode)
- Modify: `../local-llm/scripts/start-server.ps1` (`--reasoning-budget-message`) — **do not commit in local-llm** (owner-driven repo); report the diff.
- Modify: `../local-llm/CLAUDE.md` (Qwen3.5 row: per-request thinking controls) — same, do not commit.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Configure the endpoint** — in `librechat.yaml` under the `Benner` endpoint:

```yaml
      # Thinking mode (docs/adr/0001): translate reasoning effort into llama-server's
      # enable_thinking / thinking_budget_tokens. Off/Low/Medium/High only.
      customParams:
        reasoningFormat: 'llama_cpp_budget'
        thinkingBudgets: { low: 512, medium: 2048, high: 6144 }
        paramDefinitions:
          - key: reasoning_effort
            default: 'low'
            options: ['none', 'low', 'medium', 'high']
            enumMappings: { none: 'com_ui_off', low: 'com_ui_low', medium: 'com_ui_medium', high: 'com_ui_high' }
```

- [ ] **Step 2: Budget wrap-up message** — in `../local-llm/scripts/start-server.ps1` add to the header comment `#   --reasoning-budget-message  text injected when a per-request thinking budget runs out` and to the `& $llama` call:

```powershell
  --reasoning-budget-message "Okay, I have thought enough. Time to answer." `
```

- [ ] **Step 3: Build and start**

```bash
npm run build:data-provider && npm run build:api && npm run build
```

Restart llama-server and LibreChat (`scripts\start-all.bat`; close the existing tabs first).

- [ ] **Step 4: Manual verification** (record results in the PR description)

1. New Benner chat: pill reads **Low**. Ask "How many primes are below 60?". The reply shows a single "Thinking..." row with no text under it, then "Thought for Ns" (N ≲ 20), then the answer "17". Click the label: the reasoning expands.
2. Switch to **Off**, ask again: no thinking row at all, near-instant answer.
3. Switch to **High**, open a new chat: pill reads **High** (remembered). Reload an old Low chat: it still reads **Low**.
4. Side panel → Parameters: Reasoning Effort shows exactly Off/Low/Medium/High and matches the pill.
5. In Settings turn **Show Thinking** on, send a message: still no live text while thinking; the finished thought opens expanded.
6. Reload the page: finished thoughts read "Thoughts".
7. New chat on High: the auto-title appears (title request did not think).
8. Confirm on the wire: `logs/` debug output, or temporarily `curl` as in ADR 0001, shows `thinking_budget_tokens` and no `reasoning_effort` in the chat request.

- [ ] **Step 5: Document** — add to the fork section of `CLAUDE.md`, after "Attachments":

```markdown
## Thinking mode

- The input-bar pill (Off/Low/Medium/High) writes the conversation's `reasoning_effort`. For endpoints with
  `customParams.reasoningFormat: llama_cpp_budget` the backend sends llama-server's
  `chat_template_kwargs.enable_thinking` and `thinking_budget_tokens` instead (budgets in
  `customParams.thinkingBudgets`); Qwen3.5 ignores `reasoning_effort`. Titles always go out with thinking off.
  See `docs/adr/0001-thinking-mode-translated-in-librechat.md`.
- Reasoning text never streams on screen: the row shows "Thinking...", then "Thought for Ns" (click to read).
  Durations are measured in the browser and not stored, so reloaded chats show "Thoughts".
```

In `../local-llm/CLAUDE.md`, extend the Qwen3.5 row's Notes: "Per-request thinking controls (b11149): `chat_template_kwargs.enable_thinking` and `thinking_budget_tokens` work; `reasoning_effort` and `reasoning_budget` are ignored. Uncapped, it can think past `max_tokens` and return no answer."

- [ ] **Step 6: Commit (local-agent-chat only)**

```bash
git add CLAUDE.md
git commit -m "Document thinking mode"
```
