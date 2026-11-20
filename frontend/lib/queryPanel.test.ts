import { describe, expect, it } from "vitest";
import { describe, expect, it } from "vitest";
import { canRetryPanel, queryPanelState, sanitizeQuery, type QueryPanelState } from "./queryPanel";

describe("queryPanelState (FE-13 / FE-14)", () => {
  it("names all four outcomes distinctly", () => {
    const states: QueryPanelState[] = [
      queryPanelState({ isLoading: true, isError: false, isEmpty: false }),
      queryPanelState({ isLoading: false, isError: true, isEmpty: false }),
      queryPanelState({ isLoading: false, isError: false, isEmpty: true }),
      queryPanelState({ isLoading: false, isError: false, isEmpty: false }),
    ];

    expect(states).toEqual(["loading", "error", "empty", "ready"]);
    expect(new Set(states).size).toBe(4);
  });

  it("prefers loading so a retry shows progress instead of the stale error", () => {
    expect(
      queryPanelState({ isLoading: true, isError: true, isEmpty: false })
    ).toBe("loading");
  });

  it("treats an empty result as loading while the first fetch is in flight", () => {
    expect(
      queryPanelState({ isLoading: true, isError: false, isEmpty: true })
    ).toBe("loading");
  });

  it("reports an empty successful result as empty, not error", () => {
    expect(
      queryPanelState({ isLoading: false, isError: false, isEmpty: true })
    ).toBe("empty");
  });
});

describe("canRetryPanel", () => {
  it("allows a retry only for a failed panel", () => {
    expect(canRetryPanel("error")).toBe(true);
    expect(canRetryPanel("loading")).toBe(false);
    expect(canRetryPanel("empty")).toBe(false);
    expect(canRetryPanel("ready")).toBe(false);
  });
});

// F17 — Sanitize query panel input before submit ──────────────────────────────

describe("sanitizeQuery (F17)", () => {
  it("accepts a non-empty string as valid after trimming", () => {
    const result = sanitizeQuery("What is Stellar?");
    expect(result.valid).toBe(true);
    expect(result.query).toBe("What is Stellar?");
  });

  it("trims surrounding whitespace and marks non-empty trimmed input as valid", () => {
    const result = sanitizeQuery("  find me  ");
    expect(result.valid).toBe(true);
    expect(result.query).toBe("find me");
  });

  it("marks a whitespace-only string as invalid", () => {
    expect(sanitizeQuery("   ").valid).toBe(false);
    expect(sanitizeQuery("   ").query).toBe("");
  });

  it("marks an empty string as invalid", () => {
    expect(sanitizeQuery("").valid).toBe(false);
  });

  it("preserves internal whitespace while trimming the edges", () => {
    const result = sanitizeQuery("  hello world  ");
    expect(result.query).toBe("hello world");
    expect(result.valid).toBe(true);
  });
});
