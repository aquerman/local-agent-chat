import { useEffect } from 'react';
import * as Ariakit from '@ariakit/react';
import { useQueryClient } from '@tanstack/react-query';
import { TooltipAnchor, composerControlClasses } from '@librechat/client';
import { Check, ChevronDown, Lightbulb, LightbulbOff } from 'lucide-react';
import {
  Constants,
  QueryKeys,
  ReasoningEffort,
  ReasoningParameterFormat,
} from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { SetterOrUpdater } from 'recoil';
import type { ThinkingMode } from '~/hooks/Input/thinkingModePreference';
import type { TranslationKeys } from '~/hooks';
import {
  THINKING_MODES,
  isThinkingMode,
  useThinkingModePreference,
} from '~/hooks/Input/thinkingModePreference';
import { useGetEndpointsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** `Record<ThinkingMode, ...>` makes TypeScript require exactly one entry per
 *  mode: adding a mode to `THINKING_MODES` without an entry here fails to compile.
 *  The keys are written `[ReasoningEffort.x]` (computed) because string-enum
 *  members are distinct types from their plain string values. */
const modeOptions: Record<
  ThinkingMode,
  { icon: LucideIcon; label: TranslationKeys; description: TranslationKeys }
> = {
  [ReasoningEffort.none]: {
    icon: LightbulbOff,
    label: 'com_ui_thinking_mode_none',
    description: 'com_ui_thinking_mode_none_description',
  },
  [ReasoningEffort.low]: {
    icon: Lightbulb,
    label: 'com_ui_thinking_mode_low',
    description: 'com_ui_thinking_mode_low_description',
  },
  [ReasoningEffort.medium]: {
    icon: Lightbulb,
    label: 'com_ui_thinking_mode_medium',
    description: 'com_ui_thinking_mode_medium_description',
  },
  [ReasoningEffort.high]: {
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
  if (effort === ReasoningEffort.xhigh || effort === ReasoningEffort.max) {
    return ReasoningEffort.high;
  }
  if (effort === ReasoningEffort.minimal) {
    return ReasoningEffort.low;
  }
  return undefined;
}

/**
 * Input-bar pill for how much a local reasoning model may think (Off / Low /
 * Medium / High). It writes the conversation's `reasoning_effort`, which the
 * backend translates into llama-server's thinking budget for endpoints with
 * `customParams.reasoningFormat: llama_cpp_budget` (docs/adr/0001). Hidden for
 * every other endpoint.
 */
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
  const selected: ThinkingMode = stored ?? preference.get() ?? ReasoningEffort.low;
  const hasConversation = conversation != null;

  /** A conversation with no mode yet starts from the last pick. Writing it into
   *  the conversation (not just displaying it) is what makes the backend send
   *  the same mode the pill shows. */
  useEffect(() => {
    if (!available || stored != null || !hasConversation) {
      return;
    }
    setConversation((current) =>
      current == null ? current : { ...current, reasoning_effort: selected },
    );
  }, [available, stored, selected, hasConversation, setConversation]);

  if (!available) {
    return null;
  }

  /** Like `CodeApprovalMenu`: the pick also lands in the conversation detail
   *  cache, because navigation rebuilds the conversation from it. */
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
            aria-label={`${localize('com_ui_thinking_mode')}: ${localize(
              modeOptions[selected].label,
            )}`}
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
          className={cn(
            'size-3 shrink-0 text-text-secondary transition-transform',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </TooltipAnchor>
      <Ariakit.Menu
        portal={true}
        gutter={8}
        unmountOnHide={true}
        className={cn(
          'z-50 flex min-w-[280px] max-w-[min(320px,calc(100vw-2rem))] flex-col rounded-xl',
          'max-h-[var(--popover-available-height)] overflow-y-auto border border-border-light bg-presentation p-1.5 shadow-lg',
          'origin-bottom opacity-0 transition-[opacity,transform] duration-200 ease-out',
          'data-[enter]:scale-100 data-[enter]:opacity-100',
          'scale-95 data-[leave]:scale-95 data-[leave]:opacity-0',
        )}
      >
        {/* Names the menu without adding an `h1` to the page outline. */}
        <Ariakit.MenuHeading
          render={<div />}
          className="px-2.5 py-1.5 text-xs font-medium text-text-secondary"
        >
          {localize('com_ui_thinking_mode')}
        </Ariakit.MenuHeading>
        {THINKING_MODES.map((mode) => {
          const { icon: Icon, label, description } = modeOptions[mode];
          const isSelected = mode === selected;
          return (
            <Ariakit.MenuItemRadio
              key={mode}
              name="thinkingMode"
              value={mode}
              checked={isSelected}
              hideOnClick={true}
              onChange={() => selectMode(mode)}
              className={cn(
                'group flex w-full cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2',
                'outline-none transition-colors duration-theme-fast',
                'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
                isSelected && 'bg-surface-active-alt',
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-left">
                <div className="text-sm font-medium text-text-primary">{localize(label)}</div>
                <p className="text-xs text-text-secondary">{localize(description)}</p>
              </div>
              {isSelected && (
                <Check className="mt-0.5 size-4 shrink-0 text-text-primary" aria-hidden="true" />
              )}
            </Ariakit.MenuItemRadio>
          );
        })}
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}
