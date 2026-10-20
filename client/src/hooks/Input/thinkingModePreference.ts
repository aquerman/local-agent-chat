import { useAtom } from 'jotai';
import { LocalStorageKeys, ReasoningEffort } from 'librechat-data-provider';
import { createStorageAtom } from '~/store/jotai-utils';

/** The four `ReasoningEffort` values the pill offers. Built from the enum, not
 *  plain strings, because `TConversation.reasoning_effort` is typed as that enum.
 *  `as const` keeps the exact members, so `ThinkingMode` below is the union of
 *  these four rather than the whole `ReasoningEffort` type. */
export const THINKING_MODES = [
  ReasoningEffort.none,
  ReasoningEffort.low,
  ReasoningEffort.medium,
  ReasoningEffort.high,
] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];

/** A type guard: when it returns true, TypeScript narrows `value` to `ThinkingMode`
 *  in the caller, so no cast is needed after the check. */
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
