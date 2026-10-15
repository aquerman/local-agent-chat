import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { useMessageContext } from '~/Providers';

type Span = { start: number; end?: number };

/** Module-level so a thought keeps its timing when the component showing it
 *  changes mid-stream (the live fold hands over to the reasoning row, rows
 *  remount as grouping changes). One entry per thought seen in this page load;
 *  small enough to never need eviction. */
const spans = new Map<string, Span>();
const listeners = new Set<() => void>();

function beginThinking(key: string): void {
  if (!spans.has(key)) {
    spans.set(key, { start: Date.now() });
  }
}

function endThinking(key: string): void {
  const span = spans.get(key);
  if (span == null || span.end != null) {
    return;
  }
  span.end = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSeconds(key: string): number | null {
  const span = spans.get(key);
  if (span?.end == null) {
    return null;
  }
  return Math.max(1, Math.round((span.end - span.start) / 1000));
}

/**
 * Identity of the response a thought belongs to, shared by every row that can
 * show it. A streaming response carries an optimistic id ending in `_` that
 * finalization swaps for the server id; the top-level `ContentParts` keeps
 * the first id across that swap and provides it here. `null` outside one.
 */
export const ThinkingTurnContext = createContext<string | null>(null);

/** The duration key for one reasoning part: its response plus its stable
 *  part index (the same index live and after finalization). */
export function useThinkingKey(partKeyIndex: number): string {
  const turn = useContext(ThinkingTurnContext);
  const { messageId } = useMessageContext();
  return `${turn ?? messageId}:${partKeyIndex}`;
}

/**
 * Records the thought that is streaming right now, wherever it is rendered.
 * Pass the key of the trailing reasoning part while a response streams, and
 * `null` otherwise: the effect's cleanup ends the previous thought whenever
 * the key changes, so a thought ends the moment anything follows it.
 */
export function useTrackThinking(activeKey: string | null): void {
  useEffect(() => {
    if (activeKey == null) {
      return;
    }
    beginThinking(activeKey);
    return () => endThinking(activeKey);
  }, [activeKey]);
}

/**
 * Seconds a reasoning part spent thinking, measured in this browser while it
 * streamed. Durations are not persisted, so after a reload this returns `null`
 * and the caller falls back to a plain label. The row also records its own
 * span, which is a no-op when `useTrackThinking` already recorded it.
 *
 * `useSyncExternalStore` is React's hook for reading a value that lives
 * outside React (the module-level map): it re-renders this row when another
 * component ends the span.
 */
export default function useThinkingDuration(key: string, isThinking: boolean): number | null {
  useEffect(() => {
    if (isThinking) {
      beginThinking(key);
      return;
    }
    endThinking(key);
  }, [key, isThinking]);

  return useSyncExternalStore(subscribe, () => getSeconds(key));
}
