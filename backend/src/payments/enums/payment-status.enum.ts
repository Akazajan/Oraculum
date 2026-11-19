export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  /** Transient hold while a refund is in-flight (BE-46). */
  REFUNDING = 'refunding',
  REFUNDED = 'refunded',
}
