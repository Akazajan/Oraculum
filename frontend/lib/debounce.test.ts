import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebounced } from "./debounce";

describe("createDebounced", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers only the settled value of a burst", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.schedule("w");
    vi.advanceTimersByTime(100);
    debounced.schedule("wo");
    vi.advanceTimersByTime(100);
    debounced.schedule("wor");

    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("wor");
  });

  it("does not fire before the delay elapses", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.schedule("a");
    vi.advanceTimersByTime(299);

    expect(callback).not.toHaveBeenCalled();
    expect(debounced.isPending()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("drops a pending call when cancelled", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.schedule("a");
    debounced.cancel();
    vi.advanceTimersByTime(1000);

    expect(callback).not.toHaveBeenCalled();
    expect(debounced.isPending()).toBe(false);
  });

  it("delivers a pending call immediately when flushed", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.schedule("a");
    debounced.flush();

    expect(callback).toHaveBeenCalledWith("a");
    expect(debounced.isPending()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("is idle until something is scheduled", () => {
    const debounced = createDebounced(vi.fn(), 300);

    expect(debounced.isPending()).toBe(false);
    debounced.schedule();
    expect(debounced.isPending()).toBe(true);
  });
});

// F14 — Flush pending debounced input on demand ───────────────────────────────
//
// flush() invokes the latest arguments once, synchronously, and clears the
// pending timer so the callback does not fire a second time after the flush.

describe("F14 — flush pending input on demand", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("invokes the callback immediately with the latest args", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.schedule("first");
    debounced.schedule("last"); // supersedes "first"
    debounced.flush();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("last");
  });

  it("clears the pending timer so the callback does not fire a second time", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.schedule("a");
    debounced.flush();

    vi.advanceTimersByTime(1000);

    // flush already delivered the call; the deferred timer must not fire again.
    expect(callback).toHaveBeenCalledTimes(1);
    expect(debounced.isPending()).toBe(false);
  });

  it("is a no-op when nothing is pending", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.flush(); // nothing scheduled — must not throw or call the callback

    expect(callback).not.toHaveBeenCalled();
    expect(debounced.isPending()).toBe(false);
  });

  it("re-accepts a new schedule after a flush", () => {
    const callback = vi.fn();
    const debounced = createDebounced(callback, 300);

    debounced.schedule("before");
    debounced.flush();

    debounced.schedule("after");
    vi.advanceTimersByTime(300);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, "before");
    expect(callback).toHaveBeenNthCalledWith(2, "after");
  });
});
