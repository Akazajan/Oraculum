import {
  BookingQueryDto,
  resolveStatusFilter,
} from './booking-query.dto';
import { BookingStatus } from '../enums/booking-status.enum';

describe('resolveStatusFilter', () => {
  it('returns undefined when neither status nor statuses supplied', () => {
    expect(resolveStatusFilter({} as BookingQueryDto)).toBeUndefined();
  });

  it('returns a single status from the status enum field', () => {
    expect(
      resolveStatusFilter({ status: BookingStatus.PENDING } as BookingQueryDto),
    ).toBe(BookingStatus.PENDING);
  });

  it('parses a comma-separated statuses list and deduplicates', () => {
    const query = {
      statuses: 'pending,confirmed,pending',
    } as BookingQueryDto;
    expect(resolveStatusFilter(query)).toEqual([
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
    ]);
  });

  it('collapses a single-value list into a scalar', () => {
    expect(
      resolveStatusFilter({ statuses: 'cancelled' } as BookingQueryDto),
    ).toBe(BookingStatus.CANCELLED);
  });

  it('drops invalid statuses and returns undefined when none remain', () => {
    expect(
      resolveStatusFilter({ statuses: 'bogus,another' } as BookingQueryDto),
    ).toBeUndefined();
  });

  it('normalises whitespace around status values', () => {
    expect(
      resolveStatusFilter({
        statuses: ' pending , completed ',
      } as BookingQueryDto),
    ).toEqual([BookingStatus.PENDING, BookingStatus.COMPLETED]);
  });

  it('prefers statuses over status when both are supplied', () => {
    expect(
      resolveStatusFilter({
        status: BookingStatus.PENDING,
        statuses: 'cancelled,completed',
      } as BookingQueryDto),
    ).toEqual([BookingStatus.CANCELLED, BookingStatus.COMPLETED]);
  });
});
