import { describe, expect, it, vi } from "vitest";
import { createSubmissionGate } from "./bookingSubmission";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSubmissionGate", () => {
  it("runs a single task once and reports its value", async () => {
    const gate = createSubmissionGate();
    const task = vi.fn().mockResolvedValue("booking-1");

    const outcome = await gate.run(task);

    expect(outcome).toEqual({ status: "completed", value: "booking-1" });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("ignores a second submission while the first is in flight", async () => {
    const gate = createSubmissionGate();
    const first = deferred<string>();
    const task = vi.fn().mockReturnValue(first.promise);

    const inFlight = gate.run(task);
    const duplicate = gate.run(task);

    expect(gate.isInFlight()).toBe(true);
    await expect(duplicate).resolves.toEqual({ status: "ignored" });
    expect(task).toHaveBeenCalledTimes(1);

    first.resolve("booking-1");
    await expect(inFlight).resolves.toEqual({
      status: "completed",
      value: "booking-1",
    });
  });

  it("collapses a burst of clicks into one request", async () => {
    const gate = createSubmissionGate();
    const first = deferred<string>();
    const task = vi.fn().mockReturnValue(first.promise);

    const attempts = [gate.run(task), gate.run(task), gate.run(task), gate.run(task)];
    first.resolve("booking-1");
    const outcomes = await Promise.all(attempts);

    expect(task).toHaveBeenCalledTimes(1);
    expect(outcomes.filter((o) => o.status === "completed")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "ignored")).toHaveLength(3);
  });

  it("reopens the gate after a success so the control stays usable", async () => {
    const gate = createSubmissionGate();
    const task = vi.fn().mockResolvedValue("ok");

    await gate.run(task);
    await gate.run(task);

    expect(gate.isInFlight()).toBe(false);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("reopens the gate after a failure and rethrows", async () => {
    const gate = createSubmissionGate();
    const failure = new Error("Booking rejected");
    const task = vi.fn().mockRejectedValue(failure);

    await expect(gate.run(task)).rejects.toThrow("Booking rejected");
    expect(gate.isInFlight()).toBe(false);

    task.mockResolvedValue("ok");
    await expect(gate.run(task)).resolves.toEqual({
      status: "completed",
      value: "ok",
    });
  });
});
