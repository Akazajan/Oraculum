import type { PaymentAttemptStatus } from "./types/payment";

/**
 * Pure state machine for one payment attempt.
 *
 * The point of the machine is the boundary between "the provider window opened"
 * and "the payment is confirmed": only a backend confirmation may reach `paid`,
 * so no code path can report success while the payment is still pending.
 */

export interface PaymentAttemptState {
  status: PaymentAttemptStatus;
  /** Copy to show the user, or `null` when the state speaks for itself. */
  message: string | null;
}

export const initialPaymentAttemptState: PaymentAttemptState = {
  status: "idle",
  message: null,
};

export const SUBMITTED_MESSAGE =
  "Payment submitted. Waiting for the provider to confirm it.";
export const WINDOW_CLOSED_MESSAGE =
  "Payment window closed. Any completed payment will be confirmed shortly.";
export const CONFIRMED_MESSAGE = "Payment confirmed.";
export const CANCELLED_MESSAGE = "Payment cancelled.";
export const FAILED_MESSAGE = "The payment could not be started.";

export type PaymentAttemptEvent =
  | { type: "initialize" }
  | { type: "initialized" }
  | { type: "submitted" }
  | { type: "provider-closed" }
  | { type: "confirmed" }
  | { type: "failed"; message?: string }
  | { type: "cancelled" }
  | { type: "reset" };

/** A confirmed, failed or cancelled attempt has nothing further to wait for. */
export function isPaymentTerminal(state: PaymentAttemptState): boolean {
  return (
    state.status === "paid" ||
    state.status === "failed" ||
    state.status === "cancelled"
  );
}

export function paymentAttemptReducer(
  state: PaymentAttemptState,
  event: PaymentAttemptEvent
): PaymentAttemptState {
  switch (event.type) {
    case "initialize":
      return { status: "initializing", message: null };

    case "initialized":
      return { status: "initialized", message: null };

    case "submitted":
      return { status: "pending", message: SUBMITTED_MESSAGE };

    case "provider-closed":
      // Closing the window proves nothing: stay pending unless the attempt has
      // already finished, so a completed payment is not reported as cancelled.
      if (isPaymentTerminal(state)) return state;
      return { status: "pending", message: WINDOW_CLOSED_MESSAGE };

    case "confirmed":
      return { status: "paid", message: CONFIRMED_MESSAGE };

    case "failed":
      return {
        status: "failed",
        message: event.message?.trim() || FAILED_MESSAGE,
      };

    case "cancelled":
      return { status: "cancelled", message: CANCELLED_MESSAGE };

    case "reset":
      return initialPaymentAttemptState;

    default:
      return state;
  }
}

/** Copy for the current state; `paid` is the only state that claims success. */
export function paymentStatusMessage(state: PaymentAttemptState): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "initializing":
      return "Starting payment…";
    case "initialized":
      return "Payment ready — complete it in the payment window.";
    case "pending":
      return state.message ?? SUBMITTED_MESSAGE;
    case "paid":
      return state.message ?? CONFIRMED_MESSAGE;
    case "failed":
      return state.message ?? FAILED_MESSAGE;
    case "cancelled":
      return state.message ?? CANCELLED_MESSAGE;
    default:
      return null;
  }
}

/** True only once the backend has confirmed the payment. */
export function isPaymentConfirmed(state: PaymentAttemptState): boolean {
  return state.status === "paid";
}

/** True while the flow is waiting on the provider. */
export function isPaymentInFlight(state: PaymentAttemptState): boolean {
  return (
    state.status === "initializing" ||
    state.status === "initialized" ||
    state.status === "pending"
  );
}
