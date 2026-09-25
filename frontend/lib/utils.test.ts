import { formatDate } from "./utils";
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
