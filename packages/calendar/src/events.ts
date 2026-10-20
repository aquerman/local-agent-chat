import ICAL from 'ical.js';
import type { WallClock } from '~/zone';
import { isTimeZone, wallClockToDate } from '~/zone';

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type Event = InstanceType<typeof ICAL.Event>;

/** One occurrence of an event, with recurrences already expanded. */
export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  calendar?: string;
}

/** A parsed feed: its display name and its VEVENT masters with their exceptions related. */
export interface ParsedCalendar {
  name?: string;
  events: Event[];
}

export interface Range {
  start: Date;
  end: Date;
}

/** Hard stop for one recurring series, so a malformed RRULE cannot spin forever. */
const MAX_ITERATIONS = 50_000;

export class CalendarParseError extends Error {}

function readComponent(text: string): Component {
  let jcal: ReturnType<typeof ICAL.parse>;
  try {
    jcal = ICAL.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CalendarParseError(`Not a valid iCalendar file: ${reason}`);
  }
  const root = new ICAL.Component(Array.isArray(jcal[0]) ? jcal[0] : jcal);
  if (root.name !== 'vcalendar') {
    throw new CalendarParseError('Not a valid iCalendar file: no VCALENDAR found');
  }
  return root;
}

/**
 * Parses an ICS document. Embedded VTIMEZONEs are registered with ical.js's
 * process-wide timezone service so TZID references resolve; a TZID with no
 * definition is resolved later through the platform's IANA database.
 */
export function parseCalendar(text: string): ParsedCalendar {
  const root = readComponent(text);
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const tzid = zone.getFirstPropertyValue('tzid');
    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(zone);
    }
  }
  const masters = new Map<string, Event>();
  const exceptions: Event[] = [];
  const events: Event[] = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurrenceException()) {
      exceptions.push(event);
      continue;
    }
    events.push(event);
    masters.set(event.uid, event);
  }
  for (const exception of exceptions) {
    const master = masters.get(exception.uid);
    if (master) {
      master.relateException(exception);
      continue;
    }
    events.push(exception);
  }
  const name = root.getFirstPropertyValue('x-wr-calname');
  return { name: typeof name === 'string' && name !== '' ? name : undefined, events };
}

function clockOf(time: Time): WallClock {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
    second: time.isDate ? 0 : time.second,
  };
}

/**
 * Converts an ical.js time to an instant. UTC and VTIMEZONE-backed times use
 * ical.js's own conversion; a TZID ical.js does not know but the platform does
 * (feeds often omit VTIMEZONE for IANA names) goes through Intl; floating times
 * and all-day dates are read on the user's wall clock.
 */
export function toDate(time: Time, tzid: string | undefined, fallbackZone: string): Date {
  const zone = time.zone;
  const known = zone != null && zone !== ICAL.Timezone.localTimezone;
  if (!time.isDate && known) {
    return time.toJSDate();
  }
  const timeZone = !time.isDate && isTimeZone(tzid) ? tzid : fallbackZone;
  return wallClockToDate(clockOf(time), timeZone);
}

function propertyTzid(event: Event, name: 'dtstart' | 'dtend'): string | undefined {
  const value = event.component.getFirstProperty(name)?.getParameter('tzid');
  return typeof value === 'string' ? value : undefined;
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isCancelled(event: Event): boolean {
  const status = event.component.getFirstPropertyValue('status');
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED';
}

function occurrence(
  item: Event,
  start: Time,
  end: Time,
  timeZone: string,
  calendar: string | undefined,
): CalendarEvent {
  const allDay = start.isDate;
  const startDate = toDate(start, propertyTzid(item, 'dtstart'), timeZone);
  const endTzid = propertyTzid(item, 'dtend') ?? propertyTzid(item, 'dtstart');
  const endDate = toDate(end, endTzid, timeZone);
  return {
    title: text(item.summary) ?? '(no title)',
    start: startDate,
    end: endDate.getTime() > startDate.getTime() ? endDate : startDate,
    allDay,
    location: text(item.location),
    description: text(item.description),
    calendar,
  };
}

function overlaps(event: CalendarEvent, range: Range): boolean {
  const startsBeforeEnd = event.start.getTime() < range.end.getTime();
  const endsAfterStart =
    event.end.getTime() > range.start.getTime() ||
    (event.end.getTime() === event.start.getTime() &&
      event.start.getTime() >= range.start.getTime());
  return startsBeforeEnd && endsAfterStart;
}

function expandSeries(
  event: Event,
  range: Range,
  timeZone: string,
  calendar: string | undefined,
): CalendarEvent[] {
  const found: CalendarEvent[] = [];
  const iterator = event.iterator();
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = iterator.next();
    if (!next) {
      break;
    }
    const details = event.getOccurrenceDetails(next);
    if (isCancelled(details.item)) {
      continue;
    }
    const item = occurrence(details.item, details.startDate, details.endDate, timeZone, calendar);
    if (item.start.getTime() >= range.end.getTime()) {
      const original = toDate(next, propertyTzid(event, 'dtstart'), timeZone);
      if (original.getTime() >= range.end.getTime()) {
        break;
      }
      continue;
    }
    if (overlaps(item, range)) {
      found.push(item);
    }
  }
  return found;
}

/** Every occurrence of every event in `calendar` that overlaps `range`, sorted by start. */
export function eventsInRange(
  calendar: ParsedCalendar,
  range: Range,
  timeZone: string,
): CalendarEvent[] {
  const found: CalendarEvent[] = [];
  for (const event of calendar.events) {
    if (isCancelled(event)) {
      continue;
    }
    if (event.isRecurring()) {
      found.push(...expandSeries(event, range, timeZone, calendar.name));
      continue;
    }
    const item = occurrence(event, event.startDate, event.endDate, timeZone, calendar.name);
    if (overlaps(item, range)) {
      found.push(item);
    }
  }
  return found.sort((a, b) => a.start.getTime() - b.start.getTime());
}
