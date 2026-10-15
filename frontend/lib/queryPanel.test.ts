import { describe, expect, it } from "vitest";
import { canRetryPanel, queryPanelState, type QueryPanelState } from "./queryPanel";

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
