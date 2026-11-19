import type { PlanType } from "./types/booking";

/**
 * Validation for the booking form's date range, kept free of React so the rules
 * can be tested directly and reused by the review step.
 */

export type BookingFieldName = "startDate" | "endDate";

export type BookingFieldErrors = Partial<Record<BookingFieldName, string>>;

export interface BookingDateRangeInput {
  startDate: string;
  endDate: string;
  planType: PlanType;
  /** Today in `YYYY-MM-DD`. Injectable so the rule is deterministic in tests. */
  today?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Longest span each plan may cover, in whole days.
 *
 * These are the frontend's reading of the plan tiers shown in the booking form
 * (`PLAN_TYPES`): they exist to catch an obviously mismatched range — an hourly
 * booking spanning a month, say — not to re-implement pricing. The bounds are
 * deliberately generous so the client never blocks a range the backend accepts,
 * and the server remains authoritative.
 */
const PLAN_LABELS: Record<PlanType, string> = {
  HOURLY: "Hourly",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export const PLAN_MAX_DAYS: Record<PlanType, number> = {
  HOURLY: 1,
  DAILY: 31,
  WEEKLY: 31,
  MONTHLY: 92,
  QUARTERLY: 366,
  YEARLY: 366,
};

function toUtcDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return null;
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10) === value ? timestamp : null;
}

/** Whole days between two `YYYY-MM-DD` values, inclusive of both ends. */
export function inclusiveDaySpan(startDate: string, endDate: string): number | null {
  const start = toUtcDay(startDate);
  const end = toUtcDay(endDate);
  if (start === null || end === null) return null;
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

/**
 * Converts a wall-clock date/time in an IANA timezone to an instant.
 * Returns null for invalid zones and local times skipped by a DST transition.
 * When a fall-back transition makes a time ambiguous, the earlier occurrence
 * is selected consistently.
 */
function zonedDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string
): number | null {
  const day = toUtcDay(date);
  if (day === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // Force validation of the timezone before doing any calculations.
    formatter.format(new Date(day));
  } catch {
    return null;
  }

  const [hour, minute] = time.split(":").map(Number);
  const target = day + hour * 60 * 60 * 1000 + minute * 60 * 1000;
  const targetParts = { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), hour, minute };
  const matches: number[] = [];

  // Timezone offsets around the requested date are sufficient to cover normal
  // and DST-offset changes. Test each distinct offset against the wall clock.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = target + hours * 60 * 60 * 1000;
    const parts = formatter.formatToParts(new Date(sample));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute)
    );
    offsets.add(asUtc - sample);
  }

  for (const offset of offsets) {
    const candidate = target - offset;
    const parts = formatter.formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (
      Number(values.year) === targetParts.year &&
      Number(values.month) === targetParts.month &&
      Number(values.day) === targetParts.day &&
      Number(values.hour) === targetParts.hour &&
      Number(values.minute) === targetParts.minute
    ) {
      matches.push(candidate);
    }
  }

  return matches.length ? Math.min(...matches) : null;
}

export interface BookingTimeRangeInput {
  /** Selected calendar date in `YYYY-MM-DD` format. */
  selectedDate: string;
  /** Local start time in `HH:mm` format. */
  startTime: string;
  /** Local end time in `HH:mm` format. */
  endTime: string;
  /** IANA timezone, e.g. `Africa/Lagos` or `America/New_York`. */
  timeZone: string;
  /** Overnight ranges are only accepted when the caller explicitly allows them. */
  allowOvernight?: boolean;
}

/**
 * Validates a same-day or explicitly permitted overnight booking range.
 * Returns null when valid, otherwise a field-ready validation message.
 */
export function validateBookingTimeRange({
  selectedDate,
  startTime,
  endTime,
  timeZone,
  allowOvernight = false,
}: BookingTimeRangeInput): string | null {
  if (toUtcDay(selectedDate) === null) return "Select a valid booking date.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return "Enter a valid start time.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return "Enter a valid end time.";
  if (!timeZone) return "Select a valid timezone.";

  const overnight = endTime <= startTime;
  if (overnight && !allowOvernight) {
    return "The end time must be after the start time.";
  }

  const startInstant = zonedDateTimeToInstant(selectedDate, startTime, timeZone);
  const endDate = overnight
    ? new Date(toUtcDay(selectedDate)! + MS_PER_DAY).toISOString().slice(0, 10)
    : selectedDate;
  const endInstant = zonedDateTimeToInstant(endDate, endTime, timeZone);

  if (startInstant === null) return "The start time is invalid in the selected timezone.";
  if (endInstant === null) return "The end time is invalid in the selected timezone.";
  if (endInstant <= startInstant) return "The end time must be after the start time.";

  return null;
}

/**
 * Returns one message per invalid field, and an empty object when the range is
 * usable. Errors are keyed by the field the user has to fix, and a reversal is
 * reported against the end date (the field the user chose last).
 */
export function validateBookingDates({
  startDate,
  endDate,
  planType,
  today = new Date().toISOString().split("T")[0],
}: BookingDateRangeInput): BookingFieldErrors {
  const errors: BookingFieldErrors = {};

  if (!startDate) {
    errors.startDate = "Select a start date.";
  } else if (toUtcDay(startDate) === null) {
    errors.startDate = "Enter a valid start date.";
  } else if (today && toUtcDay(today) !== null && startDate < today) {
    errors.startDate = "The start date cannot be in the past.";
  }

  if (!endDate) {
    errors.endDate = "Select an end date.";
  } else if (toUtcDay(endDate) === null) {
    errors.endDate = "Enter a valid end date.";
  } else if (startDate && toUtcDay(startDate) !== null && endDate < startDate) {
    errors.endDate = "The end date cannot be before the start date.";
  }

  if (errors.startDate || errors.endDate) return errors;

  const span = inclusiveDaySpan(startDate, endDate);
  const maxDays = PLAN_MAX_DAYS[planType];
  if (span !== null && span > maxDays) {
    errors.endDate = `${PLAN_LABELS[planType]} bookings cannot span more than ${maxDays} day${maxDays === 1 ? "" : "s"}.`;
  }

  return errors;
}

export function hasBookingErrors(errors: BookingFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
