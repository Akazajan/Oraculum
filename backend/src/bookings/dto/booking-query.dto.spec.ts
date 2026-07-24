import {
  resolveStatusFilter,
} from './booking-query.dto';
import { BookingStatus } from '../enums/booking-status.enum';

describe('resolveStatusFilter', () => {
  it('returns undefined when neither status nor statuses supplied', () => {
    expect(resolveStatusFilter({} as never)).toBeUndefined();
  });

  it('returns a single status from the status enum field', () => {
    expect(
      resolveStatusFilter({ status: BookingStatus.PENDING } as never),
    ).toBe(BookingStatus.PENDING);
  });

  it('parses a comma-separated statuses list and deduplicates', () => {
    const query = {
      statuses: 'pending,confirmed,pending',
    } as never;
    expect(resolveStatusFilter(query)).toEqual([
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
    ]);
  });

  it('collapses a single-value list into a scalar', () => {
    expect(
      resolveStatusFilter({ statuses: 'cancelled' } as never),
    ).toBe(BookingStatus.CANCELLED);
  });

  it('drops invalid statuses and returns undefined when none remain', () => {
    expect(
      resolveStatusFilter({ statuses: 'bogus,another' } as never),
    ).toBeUndefined();
  });

  it('normalises whitespace around status values', () => {
    expect(
      resolveStatusFilter({
        statuses: ' pending , completed ',
      } as never),
    ).toEqual([BookingStatus.PENDING, BookingStatus.COMPLETED]);
  });

  it('prefers statuses over status when both are supplied', () => {
    expect(
      resolveStatusFilter({
        status: BookingStatus.PENDING,
        statuses: 'cancelled,completed',
      } as never),
    ).toEqual([BookingStatus.CANCELLED, BookingStatus.COMPLETED]);
  });
});
