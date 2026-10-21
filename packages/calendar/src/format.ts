import type { CalendarEvent, Range } from '~/events';
import type { WallClock } from '~/zone';
import { addDays, startOfDay, wallClockIn, wallClockToDate } from '~/zone';

export class DateInputError extends Error {}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function cached(
  map: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const hit = map.get(timeZone);
  if (hit) {
    return hit;
  }
  const formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
  map.set(timeZone, formatter);
  return formatter;
}

/** "Tue 20 Oct 2026", assembled from parts so ICU locale data cannot change the shape. */
export function formatDay(date: Date, timeZone: string): string {
  const parts = cached(dayFormatters, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
}

function formatTime(date: Date, timeZone: string): string {
  return cached(timeFormatters, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function sameDay(a: Date, b: Date, timeZone: string): boolean {
  return formatDay(a, timeZone) === formatDay(b, timeZone);
}

/** Last day an all-day event covers: DTEND is exclusive for dates. */
function lastDay(event: CalendarEvent): Date {
  if (event.end.getTime() <= event.start.getTime()) {
    return event.start;
  }
  return new Date(event.end.getTime() - 1);
}

function when(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) {
    const last = lastDay(event);
    if (sameDay(event.start, last, timeZone)) {
      return `${formatDay(event.start, timeZone)}, all day`;
    }
    return `${formatDay(event.start, timeZone)} - ${formatDay(last, timeZone)}, all day`;
  }
  const start = `${formatDay(event.start, timeZone)} ${formatTime(event.start, timeZone)}`;
  if (sameDay(event.start, event.end, timeZone)) {
    return `${start}-${formatTime(event.end, timeZone)}`;
  }
  return `${start} - ${formatDay(event.end, timeZone)} ${formatTime(event.end, timeZone)}`;
}

function clip(value: string, maxChars: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

export interface FormatOptions {
  timeZone: string;
  maxResults: number;
  maxDescriptionChars: number;
  showCalendar: boolean;
}

export function formatEvents(
  heading: string,
  events: CalendarEvent[],
  options: FormatOptions,
): string {
  if (events.length === 0) {
    return `${heading}: no events.`;
  }
  const shown = events.slice(0, options.maxResults);
  const lines = shown.map((event) => {
    const parts = [`- ${when(event, options.timeZone)}: ${event.title}`];
    if (event.location) {
      parts.push(` @ ${clip(event.location, 80)}`);
    }
    if (options.showCalendar && event.calendar) {
      parts.push(` [${event.calendar}]`);
    }
    if (event.description && options.maxDescriptionChars > 0) {
      parts.push(`\n  ${clip(event.description, options.maxDescriptionChars)}`);
    }
    return parts.join('');
  });
  const more =
    events.length > shown.length
      ? [`(${events.length - shown.length} more not shown; narrow the range to see them)`]
      : [];
  return [`${heading} (${events.length} found):`, ...lines, ...more].join('\n');
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Reads a tool's `start` argument. A bare date is midnight on the user's wall clock,
 * a date-time without offset is read on that clock too, and anything with an offset
 * or `Z` is taken as written. `today`/`tomorrow`/`yesterday` help a model that does
 * not know the date.
 */
export function parseStart(value: string | undefined, now: Date, timeZone: string): Date {
  const today = startOfDay(now, timeZone);
  const word = value?.trim().toLowerCase();
  if (!word || word === 'today' || word === 'now') {
    return today;
  }
  if (word === 'tomorrow') {
    return addDays(today, 1, timeZone);
  }
  if (word === 'yesterday') {
    return addDays(today, -1, timeZone);
  }
  const dateOnly = DATE_ONLY.exec(word);
  const local = dateOnly ? null : LOCAL_DATE_TIME.exec(word.toUpperCase().replace(' ', 'T'));
  const match = dateOnly ?? local;
  if (match) {
    const clock: WallClock = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] ?? 0),
      minute: Number(match[5] ?? 0),
      second: Number(match[6] ?? 0),
    };
    return wallClockToDate(clock, timeZone);
  }
  const parsed = new Date(value ?? '');
  if (Number.isNaN(parsed.getTime())) {
    throw new DateInputError(`Could not read the date "${value}". Use YYYY-MM-DD.`);
  }
  return parsed;
}

export function buildRange(start: Date, days: number, timeZone: string): Range {
  return { start, end: addDays(start, days, timeZone) };
}

export function describeRange(range: Range, now: Date, timeZone: string): string {
  const lastDayShown = new Date(range.end.getTime() - 1);
  const span = sameDay(range.start, lastDayShown, timeZone)
    ? formatDay(range.start, timeZone)
    : `${formatDay(range.start, timeZone)} to ${formatDay(lastDayShown, timeZone)}`;
  const clock = wallClockIn(now, timeZone);
  const nowText = `${formatDay(now, timeZone)} ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
  return `Now: ${nowText} (${timeZone}). Events ${span}`;
}
