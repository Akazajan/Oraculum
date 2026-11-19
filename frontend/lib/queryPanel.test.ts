import { describe, expect, it } from "vitest";
import { canRetryPanel, createQueryResultStore, queryPanelState, type QueryPanelState } from "./queryPanel";

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

// F18 — Preserve query results when a later query fails ───────────────────────

describe("createQueryResultStore (F18)", () => {
  it("starts with no data, no error, and not loading", () => {
    const store = createQueryResultStore<string[]>();
    const state = store.get();

    expect(state.lastSuccess).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it("stores the successful result", () => {
    const store = createQueryResultStore<string[]>();
    store.onLoading();
    store.onSuccess(["agent-a", "agent-b"]);

    expect(store.get().lastSuccess).toEqual(["agent-a", "agent-b"]);
    expect(store.get().lastError).toBeNull();
    expect(store.get().isLoading).toBe(false);
  });

  it("keeps the last successful result visible after a follow-up failure", () => {
    const store = createQueryResultStore<string[]>();

    // First query succeeds.
    store.onLoading();
    store.onSuccess(["agent-a"]);

    // Second query fails.
    store.onLoading();
    store.onError(new Error("network error"));

    const state = store.get();
    // The previous result must still be visible.
    expect(state.lastSuccess).toEqual(["agent-a"]);
    // The error from the failed follow-up is exposed.
    expect(state.lastError).toBeInstanceOf(Error);
    expect(state.isLoading).toBe(false);
  });

  it("clears the error after a subsequent successful query", () => {
    const store = createQueryResultStore<string[]>();

    store.onLoading();
    store.onSuccess(["first"]);
    store.onLoading();
    store.onError("oops");
    store.onLoading();
    store.onSuccess(["second"]);

    expect(store.get().lastSuccess).toEqual(["second"]);
    expect(store.get().lastError).toBeNull();
  });

  it("reset returns the store to its initial state", () => {
    const store = createQueryResultStore<number[]>();
    store.onSuccess([1, 2, 3]);
    store.reset();

    expect(store.get().lastSuccess).toBeNull();
    expect(store.get().lastError).toBeNull();
    expect(store.get().isLoading).toBe(false);
  });
});
