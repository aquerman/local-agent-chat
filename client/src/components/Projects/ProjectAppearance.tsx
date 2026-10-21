import { Check } from 'lucide-react';
import { CHAT_PROJECT_COLORS, CHAT_PROJECT_ICONS } from 'librechat-data-provider';
import type { TChatProjectColor, TChatProjectIcon } from 'librechat-data-provider';
import type { KeyboardEvent } from 'react';
import {
  PROJECT_ICONS,
  projectTileStyle,
  projectColorValue,
  PROJECT_COLOR_LABELS,
} from './ProjectIcon';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type ProjectAppearanceValue = {
  icon: TChatProjectIcon | null;
  color: TChatProjectColor | null;
};

type ProjectAppearanceProps = {
  value: ProjectAppearanceValue;
  onChange: (value: ProjectAppearanceValue) => void;
  labelId: string;
};

const COLOR_OPTIONS: (TChatProjectColor | null)[] = [null, ...CHAT_PROJECT_COLORS];

const ARROW_STEPS: Record<string, number | undefined> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** Moves focus among a radio group's options with the arrow keys, like a native radio group. */
function handleArrowKeys(event: KeyboardEvent<HTMLDivElement>) {
  const step = ARROW_STEPS[event.key];
  if (!step) {
    return;
  }
  const options = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  );
  const index = options.findIndex((option) => option === document.activeElement);
  if (index === -1) {
    return;
  }
  event.preventDefault();
  const next = options[(index + step + options.length) % options.length];
  next.focus();
  next.click();
}

/** Icon grid and color swatches for a project, as two radio groups. */
export default function ProjectAppearance({ value, onChange, labelId }: ProjectAppearanceProps) {
  const localize = useLocalize();
  const selectedIcon = value.icon ?? 'folder';

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={localize('com_ui_project_color')}
        onKeyDown={handleArrowKeys}
        className="flex flex-wrap gap-2"
      >
        {COLOR_OPTIONS.map((color) => {
          const selected = value.color === color;
          return (
            <button
              key={color ?? 'none'}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={localize(
                color ? PROJECT_COLOR_LABELS[color] : 'com_ui_project_color_none',
              )}
              title={localize(color ? PROJECT_COLOR_LABELS[color] : 'com_ui_project_color_none')}
              onClick={() => onChange({ ...value, color })}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border border-border-medium',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary',
                selected && 'ring-2 ring-text-primary ring-offset-2 ring-offset-surface-primary',
                !color && 'bg-surface-tertiary text-text-secondary',
              )}
              style={color ? { backgroundColor: projectColorValue(color) } : undefined}
            >
              {selected ? (
                <Check className={cn('h-3.5 w-3.5', color && 'text-white')} aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={handleArrowKeys}
        className="grid grid-cols-8 gap-1"
      >
        {CHAT_PROJECT_ICONS.map((icon) => {
          const { Icon, label } = PROJECT_ICONS[icon];
          const selected = selectedIcon === icon;
          return (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={localize(label)}
              title={localize(label)}
              onClick={() => onChange({ ...value, icon })}
              className={cn(
                'flex aspect-square items-center justify-center rounded-lg text-text-secondary transition-colors',
                'hover:bg-surface-hover hover:text-text-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
                selected && !value.color && 'bg-surface-tertiary text-text-primary',
              )}
              style={selected ? projectTileStyle(value.color) : undefined}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
