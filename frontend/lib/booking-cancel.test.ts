import { describe, it, expect, vi } from "vitest";
import { submitCancelAction } from "./booking-cancel";

describe("submitCancelAction", () => {
  it("asks for confirmation before submitting the cancellation", async () => {
    const setConfirmCancel = vi.fn();
    const cancel = vi.fn();
    const onCancelled = vi.fn();

    await submitCancelAction({
      confirmCancel: false,
      isPending: false,
      cancel,
      setConfirmCancel,
      onCancelled,
    });

    expect(setConfirmCancel).toHaveBeenCalledWith(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it("submits once after confirmation and resets the UI on success", async () => {
    const setConfirmCancel = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const onCancelled = vi.fn();

    await submitCancelAction({
      confirmCancel: true,
      isPending: false,
      cancel,
      setConfirmCancel,
      onCancelled,
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(setConfirmCancel).toHaveBeenCalledWith(false);
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it("ignores further clicks while the cancellation is pending", async () => {
    const setConfirmCancel = vi.fn();
    const cancel = vi.fn();
    const onCancelled = vi.fn();

    await submitCancelAction({
      confirmCancel: true,
      isPending: true,
      cancel,
      setConfirmCancel,
      onCancelled,
    });

    expect(cancel).not.toHaveBeenCalled();
    expect(setConfirmCancel).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
