import { ConflictException } from '@nestjs/common';

export interface RecurringBookingConflictDetails {
  occurrenceIndex: number;
  startDate: string;
  endDate: string;
  requestedSeats: number;
  availableSeats: number;
  reason: string;
}

/**
 * BE-29 — Domain-specific conflict for recurring series creation.
 *
 * Thrown from inside the single series transaction so TypeORM rolls back
 * every occurrence already staged in the unit of work. The response payload
 * carries only diagnostic fields (occurrence date/window + reason) and never
 * internal stack traces.
 */
export class RecurringBookingConflictException extends ConflictException {
  readonly details: RecurringBookingConflictDetails;

  constructor(details: RecurringBookingConflictDetails) {
    super({
      statusCode: 409,
      error: 'Conflict',
      message: `Recurring booking conflict at occurrence ${details.occurrenceIndex} (${details.startDate} to ${details.endDate}): ${details.reason}`,
      ...details,
    });
    this.details = details;
  }

  getDetails(): RecurringBookingConflictDetails {
    return this.details;
  }
}
