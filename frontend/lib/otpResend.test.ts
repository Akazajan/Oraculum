import { describe, expect, it } from "vitest";
import {
  COOLDOWN_ENDED_ANNOUNCEMENT,
  DEFAULT_RESEND_COOLDOWN_SECONDS,
  FALLBACK_FAILURE_ANNOUNCEMENT,
  SENDING_ANNOUNCEMENT,
  SENT_ANNOUNCEMENT,
  canRequestOtpResend,
  initialOtpResendState,
  otpResendLabel,
  otpResendReducer,
  type OtpResendState,
} from "./otpResend";

const request = (state: OtpResendState) => otpResendReducer(state, { type: "request" });

const succeed = (state: OtpResendState, cooldownSeconds?: number) =>
  otpResendReducer(
    request(state),
    cooldownSeconds === undefined
      ? { type: "succeeded" }
      : { type: "succeeded", cooldownSeconds },
  );

describe("otpResendReducer (FE-06)", () => {
  it("moves to sending and announces the request", () => {
    const state = request(initialOtpResendState);

    expect(state.status).toBe("sending");
    expect(state.announcement).toBe(SENDING_ANNOUNCEMENT);
    expect(canRequestOtpResend(state)).toBe(false);
  });

  it("ignores a second request while one is in flight", () => {
    const sending = request(initialOtpResendState);

    expect(request(sending)).toBe(sending);
  });

  it("enters the cooldown after a successful send", () => {
    const state = succeed(initialOtpResendState, 30);

    expect(state).toEqual({
      status: "cooldown",
      secondsRemaining: 30,
      announcement: SENT_ANNOUNCEMENT,
    });
    expect(otpResendLabel(state)).toBe("Resend code in 30s");
  });

  it("uses the default cooldown when none is supplied", () => {
    expect(succeed(initialOtpResendState).secondsRemaining).toBe(
      DEFAULT_RESEND_COOLDOWN_SECONDS,
    );
  });

  it("ignores requests during the cooldown", () => {
    const cooling = succeed(initialOtpResendState, 5);

    expect(request(cooling)).toBe(cooling);
  });

  it("counts down one second at a time without re-announcing", () => {
    let state: OtpResendState = succeed(initialOtpResendState, 3);

    state = otpResendReducer(state, { type: "tick" });
    expect(state.secondsRemaining).toBe(2);

    state = otpResendReducer(state, { type: "tick" });
    expect(state.secondsRemaining).toBe(1);
    // Re-announcing every second would flood screen readers.
    expect(state.announcement).toBe(SENT_ANNOUNCEMENT);
  });

  it("returns to idle when the cooldown elapses", () => {
    const state = otpResendReducer(succeed(initialOtpResendState, 1), { type: "tick" });

    expect(state).toEqual({
      status: "idle",
      secondsRemaining: 0,
      announcement: COOLDOWN_ENDED_ANNOUNCEMENT,
    });
    expect(canRequestOtpResend(state)).toBe(true);
  });

  it("ignores ticks outside the cooldown", () => {
    expect(otpResendReducer(initialOtpResendState, { type: "tick" })).toBe(
      initialOtpResendState,
    );
  });

  it("announces the failure message and allows another attempt", () => {
    const state = otpResendReducer(request(initialOtpResendState), {
      type: "failed",
      message: "Too many requests",
    });

    expect(state.status).toBe("error");
    expect(state.announcement).toBe("Too many requests");
    expect(canRequestOtpResend(state)).toBe(true);
    expect(otpResendLabel(state)).toBe("Resend code");
  });

  it("falls back to generic copy when the failure carries no message", () => {
    const state = otpResendReducer(request(initialOtpResendState), { type: "failed" });

    expect(state.announcement).toBe(FALLBACK_FAILURE_ANNOUNCEMENT);
  });

  it("labels the resting and sending states", () => {
    expect(otpResendLabel(initialOtpResendState)).toBe("Resend code");
    expect(otpResendLabel(request(initialOtpResendState))).toBe("Sending…");
  });
});
