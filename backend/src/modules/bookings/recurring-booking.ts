export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringBooking {
  bookingId: string;
  pattern: RecurrencePattern;
  startDate: Date;
  endDate?: Date;
  maxOccurrences?: number;
  daysOfWeek?: number[];
  interval: number;
}

export class RecurringBookingService {
  generateOccurrences(config: RecurringBooking): Date[] {
    const occurrences: Date[] = [];
    let current = new Date(config.startDate);
    let count = 0;

    while (
      count < (config.maxOccurrences || 52) &&
      (!config.endDate || current <= config.endDate)
    ) {
      occurrences.push(new Date(current));
      
      switch (config.pattern) {
        case 'daily':
          current.setDate(current.getDate() + config.interval);
          break;
        case 'weekly':
          current.setDate(current.getDate() + config.interval * 7);
          break;
        case 'monthly':
          current.setMonth(current.getMonth() + config.interval);
          break;
      }
      count++;
    }
    
    return occurrences;
  }
}
