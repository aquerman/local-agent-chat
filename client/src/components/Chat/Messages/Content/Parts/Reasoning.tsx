import { memo, useMemo, useState, useCallback, useRef, useId } from 'react';
import copy from 'copy-to-clipboard';
import { useAtom, useAtomValue } from 'jotai';
import { Lightbulb, ChevronDown } from 'lucide-react';
import { ContentTypes } from 'librechat-data-provider';
import { Button, disclosureChevronVariants } from '@librechat/client';
import type { MouseEvent, FocusEvent } from 'react';
import {
  ThinkingContent,
  ThinkingButton,
  ThinkingLabel,
  FloatingThinkingBar,
  useInViewport,
} from './Thinking';
import { useLocalize, useExpandCollapse, useLazyCollapseBody } from '~/hooks';
import useThinkingDuration from '~/hooks/Messages/useThinkingDuration';
import useSmoothStreaming from '~/hooks/Messages/useSmoothStreaming';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { showThinkingAtom } from '~/store/showThinking';
import { useReasoningDisclosure } from '../disclosure';
import { fontSizeAtom } from '~/store/fontSize';
import { useMessageContext } from '~/Providers';
import { ROW_GLYPH_SLOT } from '../rows';
import { cn } from '~/utils';

const stripThinkTags = (reasoning: string): string =>
  reasoning
    .replace(/^<think>\s*/, '')
    .replace(/\s*<\/think>$/, '')
    .trim();

type ReasoningProps = {
  partKeyIndex?: number;
  reasoning: string;
  isLast: boolean;
  reasoningLabel?: string;
};

/**
 * Reasoning Component (MODERN SYSTEM)
 *
 * Used for structured content parts with ContentTypes.THINK type.
 * This handles modern message format where content is an array of typed parts.
 *
 * Pattern: `{ content: [{ type: "think", think: "<think>content</think>" }, ...] }`
 *
 * Used by:
 * - ContentParts.tsx → Part.tsx for structured messages
 * - Agent/Assistant responses (OpenAI Assistants, custom agents)
 * - O-series models (o1, o3) with reasoning capabilities
 * - Modern Claude responses with thinking blocks
 *
 * Key differences from legacy Thinking.tsx:
 * - Works with content parts array instead of plain text
 * - Strips `<think>` tags instead of `:::thinking:::` markers
 * - Each THINK part has its own independent toggle button
 * - Can be interleaved with other content types
 *
 * For legacy text-based messages, see Thinking.tsx component.
 */
/** Reasoning that happened but whose text this view cannot show — detached
 *  subagent projections keep only a marker. Renders the shared reasoning
 *  header row without a disclosure. */
export const ReasoningMarker = memo(({ label }: { label?: string }) => {
  const localize = useLocalize();
  const display = label?.trim() || localize('com_ui_thoughts');
  return <ThinkingLabel label={display} title={localize('com_ui_thoughts_unavailable')} />;
});

ReasoningMarker.displayName = 'ReasoningMarker';

const Reasoning = memo((props: ReasoningProps) => {
  const { reasoning, isLast, reasoningLabel, partKeyIndex = 0 } = props;
  const contentId = useId();
  const localize = useLocalize();
  const showThinking = useAtomValue(showThinkingAtom);
  const smoothStreaming = useSmoothStreaming();
  const [expansionOverride, setIsExpanded] = useAtom(useReasoningDisclosure(partKeyIndex));
  const [defaultExpanded] = useState(showThinking);
  const { messageId, isSubmitting, isLatestMessage, nextType } = useMessageContext();
  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;
  /** Reasoning text is never shown live: while a thought streams the row is
   *  only a "Thinking..." label, which removes the per-token reflow the old
   *  peek caused. The user's expand choice applies once thinking ends. */
  const isThinking = Boolean(effectiveIsSubmitting) && isLast;
  const seconds = useThinkingDuration(`${messageId}:${partKeyIndex}`, isThinking);
  const isExpanded = !isThinking && (expansionOverride ?? defaultExpanded);
  const [isBarVisible, setIsBarVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { ref: headerRef, inViewport: headerInViewport } = useInViewport();
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isExpanded);
  const { shouldRenderBody, mountBody, handleTransitionEnd } = useLazyCollapseBody(isExpanded);

  // Strip <think> tags from the reasoning content (modern format)
  const reasoningText = useMemo(() => stripThinkTags(reasoning), [reasoning]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      mountBody();
      setIsExpanded(!isExpanded);
    },
    [mountBody, isExpanded, setIsExpanded],
  );

  const handleFocus = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleBlur = useCallback((e: FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsBarVisible(false);
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!containerRef.current?.contains(document.activeElement)) {
      setIsBarVisible(false);
    }
  }, []);

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

  if (!reasoningText) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="group/reasoning"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="group/thinking-container">
        <div className="mb-2 pb-2 pt-2" ref={headerRef}>
          <ThinkingButton
            isExpanded={isExpanded}
            onClick={handleClick}
            label={label}
            content={reasoningText}
            contentId={contentId}
            animateLabel={
              smoothStreaming && effectiveIsSubmitting && Boolean(reasoningLabel?.trim())
            }
            shimmerLabel={isThinking}
          />
        </div>
        <div
          id={contentId}
          role="group"
          aria-label={label}
          aria-hidden={!isExpanded || undefined}
          style={expandStyle}
          onTransitionEnd={handleTransitionEnd}
        >
          <div
            className={cn('overflow-hidden', nextType !== ContentTypes.THINK && 'pb-4')}
            ref={expandRef}
          >
            {shouldRenderBody && (
              <div className="relative">
                {/* The body only renders after thinking ends, so the word
                    fade-in has nothing left to animate. */}
                <ThinkingContent animate={false}>{reasoningText}</ThinkingContent>
                <FloatingThinkingBar
                  isVisible={isBarVisible && isExpanded && !headerInViewport}
                  isExpanded={isExpanded}
                  onClick={handleClick}
                  content={reasoningText}
                  contentId={contentId}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

Reasoning.displayName = 'Reasoning';

type ReasoningCompactProps = {
  partKeyIndex?: number;
  reasoning: string;
  label: string;
  /** The host's thoughts-visible preference, supplied by the group rather
   *  than read from the app store, so a grouped thought stays movable with
   *  the feature that renders it. */
  showThinking: boolean;
  isAfterTool?: boolean;
  /** True while this is the reasoning part currently streaming. The row then
   *  shows only its label; the text is held back until thinking ends. */
  isStreaming?: boolean;
};

/**
 * Compact reasoning row for use INSIDE a ToolCallGroup. Keeps the tool-row
 * header rhythm (icon + label + chevron) so an interleaved thought reads as a
 * sibling of the surrounding tool calls, while retaining the standalone
 * {@link Reasoning} affordances: a hover-revealed copy button on the header and
 * a floating collapse + copy bar inside the rounded content panel.
 */
export const ReasoningCompact = memo(
  ({
    reasoning,
    label,
    showThinking,
    isAfterTool = false,
    isStreaming = false,
    partKeyIndex = 0,
  }: ReasoningCompactProps) => {
    const contentId = useId();
    const localize = useLocalize();
    const fontSize = useAtomValue(fontSizeAtom);
    const [expansionOverride, setIsExpanded] = useAtom(useReasoningDisclosure(partKeyIndex));
    const [defaultExpanded] = useState(showThinking);
    const { messageId } = useMessageContext();
    /** Same key as the standalone `Reasoning` row, so a thought that moves into
     *  a tool-call group mid-stream keeps its start time. */
    const seconds = useThinkingDuration(`${messageId}:${partKeyIndex}`, isStreaming);
    const isExpanded = !isStreaming && (expansionOverride ?? defaultExpanded);
    const displayLabel =
      !isStreaming && seconds != null && label === localize('com_ui_thoughts')
        ? localize('com_ui_thought_for', { 0: String(seconds) })
        : label;
    const [isBarVisible, setIsBarVisible] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { ref: headerRef, inViewport: headerInViewport } = useInViewport();
    const { style: expandStyle, ref: expandRef } = useExpandCollapse(isExpanded);
    /** Collapsed is the default whenever thoughts are hidden, and a streaming
     *  THINK part re-renders on every delta. Keeping the full text mounted
     *  behind the invisible panel made long reasoning streams progressively
     *  more expensive. */
    const { shouldRenderBody, mountBody, handleTransitionEnd } = useLazyCollapseBody(isExpanded);

    const reasoningText = useMemo(() => stripThinkTags(reasoning), [reasoning]);

    const handleToggle = useCallback(
      (e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        mountBody();
        setIsExpanded(!isExpanded);
      },
      [mountBody, isExpanded, setIsExpanded],
    );

    const handleCopy = useCallback(() => {
      if (!copy(reasoningText, { format: 'text/plain' })) {
        return;
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }, [reasoningText]);

    const revealBar = useCallback(() => setIsBarVisible(true), []);
    const hideBar = useCallback(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setIsBarVisible(false);
      }
    }, []);
    const handleBlur = useCallback((e: FocusEvent) => {
      if (!containerRef.current?.contains(e.relatedTarget as Node)) {
        setIsBarVisible(false);
      }
    }, []);

    if (!reasoningText) {
      return null;
    }

    return (
      <div
        ref={containerRef}
        className={cn('group/reasoning-compact mb-1', isAfterTool ? 'mt-0' : 'mt-1')}
        onMouseEnter={revealBar}
        onMouseLeave={hideBar}
        onFocus={revealBar}
        onBlur={handleBlur}
      >
        <div ref={headerRef} className="relative flex h-5 shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            onClick={handleToggle}
            aria-expanded={isExpanded}
            aria-controls={contentId}
            className="group/disclosure h-auto min-w-0 flex-1 justify-start gap-2 rounded-none p-0 font-normal text-text-secondary hover:bg-transparent"
          >
            <span className={ROW_GLYPH_SLOT} aria-hidden="true">
              <Lightbulb className="size-4 shrink-0 text-text-secondary" />
            </span>
            <span className="tool-status-text font-medium">{displayLabel}</span>
            <ChevronDown
              className={cn(
                disclosureChevronVariants({ expanded: isExpanded }),
                'size-4 translate-y-[1px]',
              )}
              aria-hidden="true"
            />
          </Button>
          {isExpanded && (
            <CopyButton
              isCopied={isCopied}
              iconOnly
              onClick={handleCopy}
              label={localize('com_ui_copy_thoughts_to_clipboard')}
              copiedLabel={localize('com_ui_copied_to_clipboard')}
              className={cn(
                'shrink-0 opacity-0 transition-opacity',
                'group-focus-within/reasoning-compact:opacity-100 group-hover/reasoning-compact:opacity-100',
                'focus-visible:opacity-100',
              )}
            />
          )}
        </div>
        <div
          id={contentId}
          role="group"
          aria-label={displayLabel}
          aria-hidden={!isExpanded || undefined}
          style={expandStyle}
          onTransitionEnd={handleTransitionEnd}
        >
          <div className="overflow-hidden" ref={expandRef}>
            {shouldRenderBody && (
              <div className="relative my-2 rounded-2xl border border-border-light bg-surface-secondary p-4 pb-9 text-text-secondary">
                <p className={cn('whitespace-pre-wrap leading-[26px]', fontSize)}>
                  {reasoningText}
                </p>
                <FloatingThinkingBar
                  isVisible={isBarVisible && isExpanded && !headerInViewport}
                  isExpanded={isExpanded}
                  onClick={handleToggle}
                  content={reasoningText}
                  contentId={contentId}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

ReasoningCompact.displayName = 'ReasoningCompact';

export default Reasoning;
