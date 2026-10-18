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
