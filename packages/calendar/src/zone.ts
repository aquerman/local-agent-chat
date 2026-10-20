/** Wall-clock fields of a moment, as seen in one IANA time zone. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

export function isTimeZone(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

export function wallClockIn(date: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
  };
}

function asUtcMillis(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
}

/**
 * The instant at which `clock` is shown on a wall clock in `timeZone`.
 * Two correction passes settle DST transitions; a wall time skipped by a
 * spring-forward gap resolves to the instant just after the gap.
 */
export function wallClockToDate(clock: WallClock, timeZone: string): Date {
  const target = asUtcMillis(clock);
  let guess = target;
  for (let pass = 0; pass < 2; pass++) {
    const seen = asUtcMillis(wallClockIn(new Date(guess), timeZone));
    guess += target - seen;
  }
  return new Date(guess);
}

/** Midnight at the start of the given calendar day in `timeZone`. */
export function startOfDay(date: Date, timeZone: string): Date {
  const clock = wallClockIn(date, timeZone);
  return wallClockToDate({ ...clock, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Adds whole calendar days in `timeZone`, keeping the wall-clock time. */
export function addDays(date: Date, days: number, timeZone: string): Date {
  const clock = wallClockIn(date, timeZone);
  const shifted = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + days));
  return wallClockToDate(
    {
      ...clock,
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    },
    timeZone,
  );
}
