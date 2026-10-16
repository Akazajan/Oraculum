/**
 * Pure state machine behind the "resend verification code" control.
 *
 * Kept free of React so the duplicate-request guard, the cooldown countdown and
 * the text announced to assistive technology can all be unit tested directly.
 */

export type OtpResendStatus = "idle" | "sending" | "cooldown" | "error";

export interface OtpResendState {
  status: OtpResendStatus;
  secondsRemaining: number;
  /**
   * Text pushed to the control's live region. Only transitions change it, so the
   * per-second countdown never spams screen readers.
   */
  announcement: string | null;
}

export const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;

export const SENDING_ANNOUNCEMENT = "Sending a new verification code…";
export const SENT_ANNOUNCEMENT = "A new verification code has been sent.";
export const COOLDOWN_ENDED_ANNOUNCEMENT = "You can now request a new code.";
export const FALLBACK_FAILURE_ANNOUNCEMENT =
  "We couldn't resend the code. Please try again.";

export const initialOtpResendState: OtpResendState = {
  status: "idle",
  secondsRemaining: 0,
  announcement: null,
};

export type OtpResendEvent =
  | { type: "request" }
  | { type: "succeeded"; cooldownSeconds?: number }
  | { type: "failed"; message?: string }
  | { type: "tick" };

/** A request may only start from a resting state, never while sending or cooling down. */
export function canRequestOtpResend(state: OtpResendState): boolean {
  return state.status === "idle" || state.status === "error";
}

export function otpResendReducer(
  state: OtpResendState,
  event: OtpResendEvent,
): OtpResendState {
  switch (event.type) {
    case "request": {
      if (!canRequestOtpResend(state)) return state;
      return { status: "sending", secondsRemaining: 0, announcement: SENDING_ANNOUNCEMENT };
    }

    case "succeeded": {
      return {
        status: "cooldown",
        secondsRemaining: event.cooldownSeconds ?? DEFAULT_RESEND_COOLDOWN_SECONDS,
        announcement: SENT_ANNOUNCEMENT,
      };
    }

    case "failed": {
      return {
        status: "error",
        secondsRemaining: 0,
        announcement: event.message?.trim() || FALLBACK_FAILURE_ANNOUNCEMENT,
      };
    }

    case "tick": {
      if (state.status !== "cooldown") return state;
      if (state.secondsRemaining <= 1) {
        return {
          status: "idle",
          secondsRemaining: 0,
          announcement: COOLDOWN_ENDED_ANNOUNCEMENT,
        };
      }
      return { ...state, secondsRemaining: state.secondsRemaining - 1 };
    }

    default:
      return state;
  }
}

/** Label rendered inside the button for the current state. */
export function otpResendLabel(state: OtpResendState): string {
  switch (state.status) {
    case "sending":
      return "Sending…";
    case "cooldown":
      return `Resend code in ${state.secondsRemaining}s`;
    default:
      return "Resend code";
  }
}
