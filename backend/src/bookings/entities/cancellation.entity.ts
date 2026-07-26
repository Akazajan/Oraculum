export enum CancellationReason {
  USER_REQUESTED = 'user_requested',
  SCHEDULING_CONFLICT = 'scheduling_conflict',
  RESOURCE_UNAVAILABLE = 'resource_unavailable',
  ADMIN_CANCELLED = 'admin_cancelled',
  OTHER = 'other'
}

export interface CancellationEvent {
  bookingId: string;
  reason: CancellationReason;
  timestamp: Date;
  notes?: string;
}
