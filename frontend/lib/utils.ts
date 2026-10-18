import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "Invalid date";
  
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/** Locale every money value in the app is rendered in. */
export const DEFAULT_LOCALE = "en-NG";

/** Currency every price the API returns is denominated in. */
export const DEFAULT_CURRENCY = "NGN";

/** Minor units per major unit: 100 kobo make one naira. */
export const MINOR_UNITS_PER_MAJOR = 100;

export interface NairaFormatOptions {
  /** BCP-47 locale tag. Defaults to {@link DEFAULT_LOCALE}. */
  locale?: string;
  /** ISO 4217 currency code. Defaults to {@link DEFAULT_CURRENCY}. */
  currency?: string;
  /**
   * `standard` (the default) renders the exact amount, `compact` renders
   * summary figures such as `₦1.5M` for dashboard cards.
   */
  notation?: "standard" | "compact";
}

/** Reads the locale's own decimal separator instead of assuming a `.`. */
function decimalSeparatorFor(locale: string): string {
  return (
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? "."
  );
}

/**
 * Formats an integer kobo amount as naira, e.g. `123456` renders `₦1,234.56`.
 *
 * This is the single formatter for money in the app: amounts stay in kobo
 * (integers) until the very last moment, so nothing is rounded or scaled twice
 * on the way to the screen.
 *
 * Kobo are split from the whole naira with integer arithmetic before the value
 * is formatted. Dividing first (`kobo / 100`) loses precision once the amount
 * passes `Number.MAX_SAFE_INTEGER / 100`, which renders some large amounts a
 * kobo short; splitting keeps zero, fractional and very large amounts exact.
 * Non-integer kobo are rounded to the nearest kobo, since kobo is the smallest
 * unit the ledger carries.
 */
export function formatNaira(
  kobo: number,
  options: NairaFormatOptions = {}
): string {
  const {
    locale = DEFAULT_LOCALE,
    currency = DEFAULT_CURRENCY,
    notation = "standard",
  } = options;

  // Never render `NaN`/`Infinity` as a price.
  const amount = Number.isFinite(kobo) ? kobo : 0;

  if (notation === "compact") {
    // Compact figures are approximate by definition, so the naira value can be
    // handed to Intl directly without losing anything that is still readable.
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount / MINOR_UNITS_PER_MAJOR);
  }

  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const wholeNaira = Math.floor(absolute / MINOR_UNITS_PER_MAJOR);
  const koboRemainder = Math.round(
    absolute - wholeNaira * MINOR_UNITS_PER_MAJOR
  );

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Formatting the whole naira with no fraction digits keeps grouping, symbol
  // placement and sign placement in the locale's hands; the kobo digits are
  // then appended to the integer part so they are never rounded away.
  const parts = formatter.formatToParts(negative ? -wholeNaira : wholeNaira);
  const fraction = String(koboRemainder).padStart(2, "0");
  const decimalSeparator = decimalSeparatorFor(locale);

  let lastIntegerIndex = -1;
  parts.forEach((part, index) => {
    if (part.type === "integer") lastIntegerIndex = index;
  });

  return parts
    .map((part, index) =>
      index === lastIntegerIndex
        ? `${part.value}${decimalSeparator}${fraction}`
        : part.value
    )
    .join("");
}
