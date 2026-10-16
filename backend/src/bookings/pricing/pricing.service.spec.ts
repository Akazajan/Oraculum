import { PricingService } from './pricing.service';
import { PlanType } from '../enums/plan-type.enum';

describe('PricingService', () => {
  let service: PricingService;

  beforeEach(() => {
    service = new PricingService();
  });

  describe('calculateAmount', () => {
    it('calculates amount for a multi-day DAILY booking using calendar days', () => {
      const amount = service.calculateAmount(
        1000, // hourlyRateKobo
        PlanType.DAILY,
        2, // seatCount
        '2026-01-01',
        '2026-01-03',
      );

      // 2 calendar days * 8 working hours * hourly rate * seats
      expect(amount).toBe(1000 * 8 * 2 * 2);
    });

    it('treats a zero-duration (start == end) DAILY booking as a single day', () => {
      const amount = service.calculateAmount(
        1000,
        PlanType.DAILY,
        2,
        '2026-01-01',
        '2026-01-01',
      );

      // Math.max(1, ...) guarantees at least one billable day
      expect(amount).toBe(1000 * 8 * 1 * 2);
    });

    it('returns 0 when seatCount is zero for a DAILY plan', () => {
      const amount = service.calculateAmount(
        1000,
        PlanType.DAILY,
        0,
        '2026-01-01',
        '2026-01-05',
      );

      expect(amount).toBe(0);
    });

    it('returns 0 when seatCount is zero for a non-DAILY plan', () => {
      const amount = service.calculateAmount(
        1000,
        PlanType.WEEKLY,
        0,
        '2026-01-01',
        '2026-01-05',
      );

      expect(amount).toBe(0);
    });

    it('applies the plan discount for a WEEKLY plan', () => {
      const amount = service.calculateAmount(
        1000,
        PlanType.WEEKLY,
        1,
        '2026-01-01',
        '2026-01-08',
      );

      const gross = 1000 * 8 * 5 * 1; // WEEKLY = 5 fixed days
      expect(amount).toBe(Math.floor(gross * (1 - 0.05)));
    });

    it('uses fixed plan days regardless of date range for non-DAILY plans', () => {
      const amount = service.calculateAmount(
        1000,
        PlanType.MONTHLY,
        1,
        '2026-01-01',
        '2026-01-02',
      );

      const gross = 1000 * 8 * 22 * 1; // MONTHLY = 22 fixed days
      expect(amount).toBe(Math.floor(gross * (1 - 0.1)));
    });

    it('applies the largest discount for a YEARLY plan', () => {
      const amount = service.calculateAmount(
        1000,
        PlanType.YEARLY,
        1,
        '2026-01-01',
        '2026-12-31',
      );

      const gross = 1000 * 8 * 264 * 1; // YEARLY = 264 fixed days
      expect(amount).toBe(Math.floor(gross * (1 - 0.2)));
    });
  });

  describe('getPlanSummary', () => {
    it('returns the configured days and discount percentage', () => {
      expect(service.getPlanSummary(PlanType.YEARLY)).toEqual({
        days: 264,
        discountPct: 20,
      });
    });

    it('returns zero discount for a DAILY plan', () => {
      expect(service.getPlanSummary(PlanType.DAILY)).toEqual({
        days: 1,
        discountPct: 0,
      });
    });
  });
});
