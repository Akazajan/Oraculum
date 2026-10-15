import { describe, expect, it } from "vitest";
import {
  inclusiveDaySpan,
  validateBookingDates,
} from "./bookingValidation";

const TODAY = "2026-10-15";

describe("inclusiveDaySpan", () => {
  it("counts both endpoints", () => {
    expect(inclusiveDaySpan("2026-10-15", "2026-10-15")).toBe(1);
    expect(inclusiveDaySpan("2026-10-15", "2026-10-21")).toBe(7);
  });

  it("returns null when either value is not a plain date", () => {
    expect(inclusiveDaySpan("", "2026-10-21")).toBeNull();
    expect(inclusiveDaySpan("2026-10-15", "not-a-date")).toBeNull();
    expect(inclusiveDaySpan("2026-10-15T10:00:00Z", "2026-10-21")).toBeNull();
  });
});

describe("validateBookingDates", () => {
  it("accepts a forward range within the plan bound", () => {
    expect(
      validateBookingDates({
        startDate: TODAY,
        endDate: "2026-10-16",
        planType: "DAILY",
        today: TODAY,
      })
    ).toEqual({});
  });

  it("flags a missing start date and a missing end date separately", () => {
    const errors = validateBookingDates({
      startDate: "",
      endDate: "",
      planType: "DAILY",
      today: TODAY,
    });

    expect(errors.startDate).toBe("Select a start date.");
    expect(errors.endDate).toBe("Select an end date.");
  });

  it("rejects a start date in the past", () => {
    const errors = validateBookingDates({
      startDate: "2026-10-14",
      endDate: "2026-10-20",
      planType: "WEEKLY",
      today: TODAY,
    });

    expect(errors.startDate).toBe("The start date cannot be in the past.");
    expect(errors.endDate).toBeUndefined();
  });

  it("allows a start date of today", () => {
    const errors = validateBookingDates({
      startDate: TODAY,
      endDate: "2026-10-21",
      planType: "WEEKLY",
      today: TODAY,
    });

    expect(errors).toEqual({});
  });

  it("rejects a reversed range and reports it against the end date", () => {
    const errors = validateBookingDates({
      startDate: "2026-10-20",
      endDate: "2026-10-16",
      planType: "WEEKLY",
      today: TODAY,
    });

    expect(errors.endDate).toBe("The end date cannot be before the start date.");
    expect(errors.startDate).toBeUndefined();
  });

  it("reports both dates when the start is in the past and the end precedes it", () => {
    const errors = validateBookingDates({
      startDate: "2026-10-01",
      endDate: "2026-09-01",
      planType: "DAILY",
      today: TODAY,
    });

    expect(errors.startDate).toBe("The start date cannot be in the past.");
    expect(errors.endDate).toBe(
      "The end date cannot be before the start date."
    );
  });

  it("rejects a malformed date", () => {
    const errors = validateBookingDates({
      startDate: "15/10/2026",
      endDate: "2026-10-20",
      planType: "DAILY",
      today: TODAY,
    });

    expect(errors.startDate).toBe("Enter a valid start date.");
  });

  it("rejects a range longer than the plan allows and names the plan", () => {
    const errors = validateBookingDates({
      startDate: TODAY,
      endDate: "2026-10-16",
      planType: "HOURLY",
      today: TODAY,
    });

    expect(errors.endDate).toBe(
      "Hourly bookings cannot span more than 1 day."
    );
  });

  it("singularises the day count for a one-day bound", () => {
    const errors = validateBookingDates({
      startDate: TODAY,
      endDate: "2026-11-30",
      planType: "HOURLY",
      today: TODAY,
    });

    expect(errors.endDate).toContain("more than 1 day.");
    expect(errors.endDate).not.toContain("days");
  });

  it("accepts a quarterly range inside its bound", () => {
    const errors = validateBookingDates({
      startDate: TODAY,
      endDate: "2026-12-01",
      planType: "QUARTERLY",
      today: TODAY,
    });

    expect(errors).toEqual({});
  });

  it("rejects a range longer than the plan bound with a plural day count", () => {
    const errors = validateBookingDates({
      startDate: TODAY,
      endDate: "2026-11-30",
      planType: "DAILY",
      today: TODAY,
    });

    expect(errors.endDate).toBe("Daily bookings cannot span more than 31 days.");
  });
});
