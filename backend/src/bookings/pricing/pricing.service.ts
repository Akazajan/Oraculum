import { Injectable } from '@nestjs/common';
import { PlanType } from '../enums/plan-type.enum';

const PLAN_WORKING_HOURS = 8;

const PLAN_DAYS: Record<PlanType, number> = {
  [PlanType.DAILY]: 1,
  [PlanType.WEEKLY]: 5,
  [PlanType.MONTHLY]: 22,
  [PlanType.QUARTERLY]: 66,
  [PlanType.YEARLY]: 264,
};

// B37 — Discounts are stored as integer percent points so the pricing
// math stays in integer minor units and never introduces floating-point
// artifacts (e.g. 0.05 * gross losing a kobo to IEEE-754 rounding).
const PLAN_DISCOUNT_PCT: Record<PlanType, number> = {
  [PlanType.DAILY]: 0,
  [PlanType.WEEKLY]: 5,
  [PlanType.MONTHLY]: 10,
  [PlanType.QUARTERLY]: 15,
  [PlanType.YEARLY]: 20,
};

@Injectable()
export class PricingService {
  /**
   * Calculate total booking amount in kobo.
   * For DAILY plan the actual calendar days between startDate and endDate are used.
   * For all other plans the fixed multipliers are used.
   *
   * The discount is applied with integer arithmetic
   * (gross * (100 - discountPct)) / 100 so the result is deterministic
   * and free of floating-point drift. Half-unit rounding follows the
   * documented floor rule.
   */
  calculateAmount(
    hourlyRateKobo: number,
    planType: PlanType,
    seatCount: number,
    startDate: string,
    endDate: string,
  ): number {
    let days: number;

    if (planType === PlanType.DAILY) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffMs = end.getTime() - start.getTime();
      days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    } else {
      days = PLAN_DAYS[planType];
    }

    const gross = hourlyRateKobo * PLAN_WORKING_HOURS * days * seatCount;
    const discountPct = PLAN_DISCOUNT_PCT[planType];
    return Math.floor((gross * (100 - discountPct)) / 100);
  }

  getPlanSummary(planType: PlanType): { days: number; discountPct: number } {
    return {
      days: PLAN_DAYS[planType],
      discountPct: PLAN_DISCOUNT_PCT[planType],
    };
  }
}
