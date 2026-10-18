export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";

/**
 * An integer amount in kobo (1 naira = 100 kobo).
 *
 * Every price the API accepts or returns is carried in this unit so no value is
 * scaled or rounded on the way through the app; render it with `formatNaira`
 * from `@/lib/utils` instead of dividing by 100 at the call site.
 */
export type KoboAmount = number;

/**
 * An amount denominated in whole naira. Only used for values the API documents
 * as naira, such as `PriceEstimate.totalAmountNaira`.
 */
export type NairaAmount = number;

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
  amount: KoboAmount;
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
