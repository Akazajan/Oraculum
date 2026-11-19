import { formatDate, formatNaira } from "./utils";
import { describe, it, expect } from "vitest";

describe("formatDate", () => {
  it("formats a valid date string", () => {
    const date = "2026-08-29T10:00:00Z";
    expect(formatDate(date)).toBe("Aug 29, 2026");
  });

  it("formats a Date object", () => {
    const date = new Date("2026-08-29T10:00:00Z");
    expect(formatDate(date)).toBe("Aug 29, 2026");
  });

  it("handles undefined", () => {
    expect(formatDate(undefined)).toBe("N/A");
  });

  it("handles null", () => {
    expect(formatDate(null)).toBe("N/A");
  });

  it("handles invalid date strings", () => {
    expect(formatDate("invalid-date")).toBe("Invalid date");
  });
});

/**
 * `formatNaira` is the one place kobo is scaled to naira, so these cases pin the
 * conversions the whole app depends on: zero, kobo fractions, amounts that used
 * to be rounded away, and values past the safe-integer division boundary.
 */
describe("formatNaira", () => {
  it("formats zero as ₦0.00", () => {
    expect(formatNaira(0)).toBe("₦0.00");
  });

  it("keeps the kobo part instead of rounding it away", () => {
    expect(formatNaira(1)).toBe("₦0.01");
    expect(formatNaira(50)).toBe("₦0.50");
    expect(formatNaira(105)).toBe("₦1.05");
    expect(formatNaira(999)).toBe("₦9.99");
  });

  it("scales kobo to naira exactly once", () => {
    expect(formatNaira(123456)).toBe("₦1,234.56");
    expect(formatNaira(100_000_00)).toBe("₦100,000.00");
  });

  it("formats large amounts without losing a kobo", () => {
    // Number.MAX_SAFE_INTEGER kobo: dividing first would render ...409.90.
    expect(formatNaira(Number.MAX_SAFE_INTEGER)).toBe(
      "₦90,071,992,547,409.91"
    );
    expect(formatNaira(123_456_789_012_345)).toBe(
      "₦1,234,567,890,123.45"
    );
  });

  it("formats negative amounts", () => {
    expect(formatNaira(-123456)).toBe("-₦1,234.56");
    expect(formatNaira(-50)).toBe("-₦0.50");
  });

  it("rounds non-integer kobo to the nearest kobo", () => {
    expect(formatNaira(1234.5)).toBe("₦12.35");
    expect(formatNaira(1234.4)).toBe("₦12.34");
  });

  it("falls back to zero for values that are not finite", () => {
    expect(formatNaira(Number.NaN)).toBe("₦0.00");
    expect(formatNaira(Number.POSITIVE_INFINITY)).toBe("₦0.00");
  });

  it("supports compact notation for summary figures", () => {
    // 150,000,000 kobo = ₦1,500,000
    expect(formatNaira(150_000_000, { notation: "compact" })).toBe("₦1.5M");
  });

  it("honours locale and currency overrides", () => {
    expect(formatNaira(123456, { locale: "en-US", currency: "USD" })).toBe(
      "$1,234.56"
    );
  });
});
