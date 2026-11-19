import { describe, expect, it, vi } from "vitest";
import {
  createSubmissionGate,
  getBookingSubmissionError,
  mapBookingSubmissionError,
  mapBookingSubmissionErrors,
  mapServerBookingError,
} from "./bookingSubmission";

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

  describe("booking submission server errors", () => {
    it("maps Nest validation messages to stable fields", () => {
      const error = {
        status: 400,
        data: {
          message: [
            "workspaceId must be a UUID",
            "endDate must be after startDate",
            "seatCount must be at least 1",
          ],
        },
      };

      expect(mapBookingSubmissionError(error)).toEqual({
        workspaceId: "workspaceId must be a UUID",
        endDate: "endDate must be after startDate",
        seatCount: "seatCount must be at least 1",
      });
    });

    it("maps structured field errors without changing server text", () => {
      const error = {
        status: 422,
        data: {
          errors: {
            startDate: "The start date cannot be in the past.",
            seatCount: "Choose at least one seat.",
          },
        },
      };

      expect(mapBookingSubmissionErrors(error)).toEqual({
        startDate: "The start date cannot be in the past.",
        seatCount: "Choose at least one seat.",
      });
    });

    it("maps an availability conflict to seatCount", () => {
      const error = {
        status: 409,
        code: "SEATS_UNAVAILABLE",
        serverMessage: "Only 2 seat(s) available for the requested dates",
        message: "Only 2 seat(s) available for the requested dates",
      };

      expect(mapServerBookingError(error)).toEqual({
        seatCount: "Only 2 seat(s) available for the requested dates",
      });
    });

    it("preserves a generic server message as the form fallback", () => {
      const error = {
        status: 500,
        serverMessage: "The booking service is unavailable.",
        message: "The booking service is unavailable.",
      };

      expect(getBookingSubmissionError(error)).toEqual({
        fieldErrors: {},
        formError: "The booking service is unavailable.",
      });
    });

    it("returns no field error for a message that has no known booking field", () => {
      expect(
        mapBookingSubmissionError({
          status: 422,
          serverMessage: "The submitted data is invalid.",
        })
      ).toEqual({});
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
