export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";

/**
 * Lifecycle of one payment attempt, from pressing "Pay" until the provider
 * confirms it. `paid` is only reachable from a backend confirmation, so the UI
 * can tell "waiting" apart from "settled".
 */
export type PaymentAttemptStatus =
  | "idle"
  | "initializing"
  | "initialized"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled";
export type PaymentProvider = "PAYSTACK" | "STELLAR";

export interface Payment {
  id: string;
  bookingId: string;
  userId: string;
  amount: number; // kobo
  currency: string;
  provider: PaymentProvider;
  providerReference?: string;
  status: PaymentStatus;
  paidAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InitializePaymentResponse {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  paymentId: string;
}
