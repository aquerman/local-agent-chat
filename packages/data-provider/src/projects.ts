/** Icons a chat project can show, as lucide icon names. `folder` is the default. */
export const CHAT_PROJECT_ICONS = [
  'folder',
  'briefcase',
  'code',
  'book-open',
  'graduation-cap',
  'flask-conical',
  'lightbulb',
  'rocket',
  'pen-tool',
  'palette',
  'music',
  'camera',
  'heart',
  'house',
  'plane',
  'globe',
  'shopping-cart',
  'dumbbell',
  'leaf',
  'star',
  'wrench',
  'bot',
  'calendar',
  'users',
] as const;

export type TChatProjectIcon = (typeof CHAT_PROJECT_ICONS)[number];

/** Colors a chat project can carry. No color shows the project in the theme's neutral text color. */
export const CHAT_PROJECT_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const;

export type TChatProjectColor = (typeof CHAT_PROJECT_COLORS)[number];

const iconSet: ReadonlySet<string> = new Set(CHAT_PROJECT_ICONS);
const colorSet: ReadonlySet<string> = new Set(CHAT_PROJECT_COLORS);

export const isChatProjectIcon = (value: unknown): value is TChatProjectIcon =>
  typeof value === 'string' && iconSet.has(value);

export const isChatProjectColor = (value: unknown): value is TChatProjectColor =>
  typeof value === 'string' && colorSet.has(value);
