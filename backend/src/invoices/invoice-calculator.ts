export interface InvoiceLineItem {
  description: string;
  unitAmountCents: number;
  quantity: number;
}

export interface DiscountConfig {
  type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number; // Percentage (e.g., 15 for 15%) or Cents (e.g., 1000 for $10.00)
}

export interface InvoiceCalculationInput {
  lineItems: InvoiceLineItem[];
  discount?: DiscountConfig;
  taxRatePercent?: number; // e.g. 8.875 for 8.875%
  prorationFactor?: number; // e.g. 0.5 for 50% partial billing duration
}

export interface InvoiceCalculationResult {
  subtotalCents: number;
  proratedSubtotalCents: number;
  discountCents: number;
  taxableAmountCents: number;
  taxCents: number;
  totalCents: number;
}

export class InvoiceCalculator {
  /**
   * Calculates total invoice breakdown handling rounding, discounts, tax rates, and proration edge cases.
   */
  static calculate(input: InvoiceCalculationInput): InvoiceCalculationResult {
    const { lineItems, discount, taxRatePercent = 0, prorationFactor = 1.0 } = input;

    // 1. Calculate raw subtotal from line items
    const subtotalCents = lineItems.reduce((acc, item) => {
      const lineTotal = Math.round(item.unitAmountCents * item.quantity);
      return acc + lineTotal;
    }, 0);

    // 2. Apply proration factor (rounded to nearest integer cent)
    const proratedSubtotalCents = Math.max(
      0,
      Math.round(subtotalCents * Math.max(0, prorationFactor)),
    );

    // 3. Compute discount based on prorated subtotal
    let discountCents = 0;
    if (discount) {
      if (discount.type === 'PERCENTAGE') {
        const clampedPercent = Math.min(100, Math.max(0, discount.value));
        discountCents = Math.round((proratedSubtotalCents * clampedPercent) / 100);
      } else if (discount.type === 'FIXED_AMOUNT') {
        discountCents = Math.max(0, Math.round(discount.value));
      }
    }

    // Ensure discount never exceeds the subtotal
    discountCents = Math.min(proratedSubtotalCents, discountCents);

    // 4. Taxable amount after discount
    const taxableAmountCents = proratedSubtotalCents - discountCents;

    // 5. Calculate tax using half-up cent rounding
    const clampedTaxRate = Math.max(0, taxRatePercent);
    const taxCents = Math.round((taxableAmountCents * clampedTaxRate) / 100);

    // 6. Calculate grand total
    const totalCents = taxableAmountCents + taxCents;

    return {
      subtotalCents,
      proratedSubtotalCents,
      discountCents,
      taxableAmountCents,
      taxCents,
      totalCents,
    };
  }
}