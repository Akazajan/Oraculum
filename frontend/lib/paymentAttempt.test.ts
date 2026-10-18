import { describe, expect, it } from "vitest";
import {
  CANCELLED_MESSAGE,
  CONFIRMED_MESSAGE,
  FAILED_MESSAGE,
  SUBMITTED_MESSAGE,
  WINDOW_CLOSED_MESSAGE,
  initialPaymentAttemptState,
  isPaymentConfirmed,
  isPaymentInFlight,
  isPaymentTerminal,
  paymentAttemptReducer,
  paymentStatusMessage,
  type PaymentAttemptState,
} from "./paymentAttempt";

type PaymentAttemptEvent = Parameters<typeof paymentAttemptReducer>[1];

const go = (state: PaymentAttemptState, ...events: PaymentAttemptEvent[]) =>
  events.reduce(paymentAttemptReducer, state);

describe("paymentAttemptReducer (FE-09)", () => {
  it("distinguishes initialized from pending and paid", () => {
    const initialized = go(initialPaymentAttemptState, { type: "initialize" }, { type: "initialized" });
    expect(initialized.status).toBe("initialized");

    const pending = paymentAttemptReducer(initialized, { type: "submitted" });
    expect(pending.status).toBe("pending");
    expect(pending.message).toBe(SUBMITTED_MESSAGE);

    const paid = paymentAttemptReducer(pending, { type: "confirmed" });
    expect(paid.status).toBe("paid");
    expect(paid.message).toBe(CONFIRMED_MESSAGE);
  });

  it("never claims success before confirmation", () => {
    const pending = paymentAttemptReducer(initialPaymentAttemptState, {
      type: "submitted",
    });

    expect(isPaymentConfirmed(pending)).toBe(false);
    expect(isPaymentInFlight(pending)).toBe(true);
    expect(paymentStatusMessage(pending)).not.toMatch(/confirmed\.$/);
  });

  it("stays pending when the provider window closes on an unfinished attempt", () => {
    const submitted = paymentAttemptReducer(initialPaymentAttemptState, {
      type: "submitted",
    });

    const closed = paymentAttemptReducer(submitted, { type: "provider-closed" });
    expect(closed.status).toBe("pending");
    expect(closed.message).toBe(WINDOW_CLOSED_MESSAGE);
  });

  it("does not downgrade an attempt that already finished", () => {
    const paid = go(
      initialPaymentAttemptState,
      { type: "initialize" },
      { type: "initialized" },
      { type: "submitted" },
      { type: "confirmed" }
    );

    expect(paymentAttemptReducer(paid, { type: "provider-closed" })).toBe(paid);
  });

  it("records a failure with the server message, or generic copy", () => {
    const failed = paymentAttemptReducer(initialPaymentAttemptState, {
      type: "failed",
      message: "Insufficient funds",
    });
    expect(failed.status).toBe("failed");
    expect(failed.message).toBe("Insufficient funds");

    const anonymous = paymentAttemptReducer(initialPaymentAttemptState, {
      type: "failed",
    });
    expect(anonymous.message).toBe(FAILED_MESSAGE);
  });

  it("records a cancellation", () => {
    const cancelled = paymentAttemptReducer(initialPaymentAttemptState, {
      type: "cancelled",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.message).toBe(CANCELLED_MESSAGE);
    expect(isPaymentTerminal(cancelled)).toBe(true);
  });

  it("resets back to idle", () => {
    const paid = go(initialPaymentAttemptState, { type: "confirmed" });
    expect(paymentAttemptReducer(paid, { type: "reset" })).toBe(
      initialPaymentAttemptState
    );
  });

  it("keeps the in-flight and confirmed predicates disjoint", () => {
    const paid = go(initialPaymentAttemptState, { type: "confirmed" });

    expect(isPaymentConfirmed(paid)).toBe(true);
    expect(isPaymentInFlight(paid)).toBe(false);
    expect(isPaymentConfirmed(initialPaymentAttemptState)).toBe(false);
    expect(paymentStatusMessage(initialPaymentAttemptState)).toBeNull();
  });
});
