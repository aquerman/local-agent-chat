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
  /** `useReducer` here is only a "force re-render" switch: the duration lives in
   *  the module-level map, not in React state, so the hook must ask React to
   *  render again once it records the end time. */
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
