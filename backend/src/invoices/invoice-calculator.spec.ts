import { InvoiceCalculator, InvoiceCalculationInput } from './invoice-calculator';

describe('InvoiceCalculator Edge Cases & Regression Tests (#56 BE-47)', () => {
  describe('Standard Billing Baseline', () => {
    it('should correctly calculate simple line items without discount or tax', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [
          { description: 'Desk Space', unitAmountCents: 2500, quantity: 2 }, // $50.00
          { description: 'Monitor Rental', unitAmountCents: 1500, quantity: 1 }, // $15.00
        ],
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.subtotalCents).toBe(6500);
      expect(result.discountCents).toBe(0);
      expect(result.taxCents).toBe(0);
      expect(result.totalCents).toBe(6500);
    });
  });

  describe('Discount Edge Cases', () => {
    it('should apply percentage discount and handle fractional cent rounding correctly', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [{ description: 'Meeting Room', unitAmountCents: 3333, quantity: 1 }], // $33.33
        discount: { type: 'PERCENTAGE', value: 15 }, // 15% off = 499.95 cents -> rounds to 500
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.discountCents).toBe(500);
      expect(result.taxableAmountCents).toBe(2833);
      expect(result.totalCents).toBe(2833);
    });

    it('should cap fixed amount discount at subtotal to prevent negative totals', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [{ description: 'Storage Locker', unitAmountCents: 1000, quantity: 1 }], // $10.00
        discount: { type: 'FIXED_AMOUNT', value: 5000 }, // $50.00 discount (over-discount)
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.discountCents).toBe(1000); // capped at $10.00
      expect(result.taxableAmountCents).toBe(0);
      expect(result.totalCents).toBe(0);
    });

    it('should clamp invalid percentage discounts exceeding 100%', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [{ description: 'Day Pass', unitAmountCents: 4000, quantity: 1 }],
        discount: { type: 'PERCENTAGE', value: 150 }, // 150% discount invalid
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.discountCents).toBe(4000); // 100% max
      expect(result.totalCents).toBe(0);
    });
  });

  describe('Tax & Rounding Edge Cases', () => {
    it('should handle multi-decimal precision tax rates accurately (e.g. 8.875% NYC tax)', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [{ description: 'Hot Desk Pass', unitAmountCents: 10000, quantity: 1 }], // $100.00
        taxRatePercent: 8.875, // $8.875 -> rounds to 888 cents ($8.88)
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.taxCents).toBe(888);
      expect(result.totalCents).toBe(10888);
    });

    it('should apply tax strictly AFTER discount application', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [{ description: 'Event Space', unitAmountCents: 20000, quantity: 1 }], // $200.00
        discount: { type: 'FIXED_AMOUNT', value: 5000 }, // -$50.00 -> $150.00 taxable
        taxRatePercent: 10, // 10% on $150.00 = $15.00 tax (1500 cents)
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.taxableAmountCents).toBe(15000);
      expect(result.taxCents).toBe(1500);
      expect(result.totalCents).toBe(16500);
    });
  });

  describe('Partial Charges & Proration Factors', () => {
    it('should prorate subtotal cleanly for mid-cycle bookings', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [{ description: 'Dedicated Desk Monthly', unitAmountCents: 30000, quantity: 1 }], // $300.00
        prorationFactor: 0.3333, // 1/3 of the month -> 9999 cents ($99.99)
        taxRatePercent: 10,
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.proratedSubtotalCents).toBe(9999);
      expect(result.taxCents).toBe(1000);
      expect(result.totalCents).toBe(10999);
    });

    it('should handle zero-cost or zero-quantity line items gracefully', () => {
      const input: InvoiceCalculationInput = {
        lineItems: [
          { description: 'Free Wifi', unitAmountCents: 0, quantity: 1 },
          { description: 'Unused Addon', unitAmountCents: 2000, quantity: 0 },
        ],
      };

      const result = InvoiceCalculator.calculate(input);

      expect(result.subtotalCents).toBe(0);
      expect(result.totalCents).toBe(0);
    });
  });
});