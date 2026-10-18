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
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** Whole days between two `YYYY-MM-DD` values, inclusive of both ends. */
export function inclusiveDaySpan(startDate: string, endDate: string): number | null {
  const start = toUtcDay(startDate);
  const end = toUtcDay(endDate);
  if (start === null || end === null) return null;
  return Math.round((end - start) / MS_PER_DAY) + 1;
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
