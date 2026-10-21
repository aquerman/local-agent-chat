import {
  Bot,
  Briefcase,
  BookOpen,
  Calendar,
  Camera,
  Code,
  Dumbbell,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  House,
  Leaf,
  Lightbulb,
  Music,
  Palette,
  PenTool,
  Plane,
  Rocket,
  ShoppingCart,
  Star,
  Users,
  Wrench,
} from 'lucide-react';
import type { TChatProject, TChatProjectColor, TChatProjectIcon } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { cn } from '~/utils';

type ProjectIconEntry = { Icon: LucideIcon; label: TranslationKeys };

/** Every selectable icon, in picker order, with its accessible name. */
export const PROJECT_ICONS: Record<TChatProjectIcon, ProjectIconEntry> = {
  folder: { Icon: Folder, label: 'com_ui_project_icon_folder' },
  briefcase: { Icon: Briefcase, label: 'com_ui_project_icon_briefcase' },
  code: { Icon: Code, label: 'com_ui_project_icon_code' },
  'book-open': { Icon: BookOpen, label: 'com_ui_project_icon_book_open' },
  'graduation-cap': { Icon: GraduationCap, label: 'com_ui_project_icon_graduation_cap' },
  'flask-conical': { Icon: FlaskConical, label: 'com_ui_project_icon_flask_conical' },
  lightbulb: { Icon: Lightbulb, label: 'com_ui_project_icon_lightbulb' },
  rocket: { Icon: Rocket, label: 'com_ui_project_icon_rocket' },
  'pen-tool': { Icon: PenTool, label: 'com_ui_project_icon_pen_tool' },
  palette: { Icon: Palette, label: 'com_ui_project_icon_palette' },
  music: { Icon: Music, label: 'com_ui_project_icon_music' },
  camera: { Icon: Camera, label: 'com_ui_project_icon_camera' },
  heart: { Icon: Heart, label: 'com_ui_project_icon_heart' },
  house: { Icon: House, label: 'com_ui_project_icon_house' },
  plane: { Icon: Plane, label: 'com_ui_project_icon_plane' },
  globe: { Icon: Globe, label: 'com_ui_project_icon_globe' },
  'shopping-cart': { Icon: ShoppingCart, label: 'com_ui_project_icon_shopping_cart' },
  dumbbell: { Icon: Dumbbell, label: 'com_ui_project_icon_dumbbell' },
  leaf: { Icon: Leaf, label: 'com_ui_project_icon_leaf' },
  star: { Icon: Star, label: 'com_ui_project_icon_star' },
  wrench: { Icon: Wrench, label: 'com_ui_project_icon_wrench' },
  bot: { Icon: Bot, label: 'com_ui_project_icon_bot' },
  calendar: { Icon: Calendar, label: 'com_ui_project_icon_calendar' },
  users: { Icon: Users, label: 'com_ui_project_icon_users' },
};

/** Accessible names of the project colors. */
export const PROJECT_COLOR_LABELS: Record<TChatProjectColor, TranslationKeys> = {
  red: 'com_ui_project_color_red',
  orange: 'com_ui_project_color_orange',
  yellow: 'com_ui_project_color_yellow',
  green: 'com_ui_project_color_green',
  teal: 'com_ui_project_color_teal',
  blue: 'com_ui_project_color_blue',
  indigo: 'com_ui_project_color_indigo',
  purple: 'com_ui_project_color_purple',
  pink: 'com_ui_project_color_pink',
};

/** The CSS color of a project color, defined per theme in `style.css`. */
export const projectColorValue = (color?: TChatProjectColor | null): string | undefined =>
  color ? `var(--project-${color})` : undefined;

/** A tile's background: the project color at low strength, so the icon keeps its contrast. */
export const projectTileStyle = (color?: TChatProjectColor | null): CSSProperties | undefined =>
  color
    ? {
        color: projectColorValue(color),
        backgroundColor: `color-mix(in srgb, ${projectColorValue(color)} 14%, transparent)`,
      }
    : undefined;

type ProjectAppearance = Pick<TChatProject, 'icon' | 'color'>;

type ProjectIconProps = {
  project?: ProjectAppearance | null;
  className?: string;
};

/** A project's icon in its color; a project without either shows the neutral folder. */
export default function ProjectIcon({ project, className }: ProjectIconProps) {
  const Icon = PROJECT_ICONS[project?.icon ?? 'folder']?.Icon ?? Folder;
  const color = projectColorValue(project?.color);
  return (
    <Icon
      className={cn('shrink-0', !color && 'text-text-secondary', className)}
      style={color ? { color } : undefined}
      aria-hidden="true"
    />
  );
}

type ProjectIconTileProps = ProjectIconProps & {
  iconClassName?: string;
};

/** The icon on a rounded tile tinted with the project color, for cards and headers. */
export function ProjectIconTile({ project, className, iconClassName }: ProjectIconTileProps) {
  const Icon = PROJECT_ICONS[project?.icon ?? 'folder']?.Icon ?? Folder;
  const style = projectTileStyle(project?.color);
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        !style && 'bg-surface-tertiary text-text-secondary',
        className,
      )}
      style={style}
    >
      <Icon className={iconClassName} aria-hidden="true" />
    </span>
  );
}
