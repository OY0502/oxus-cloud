// All monetary values in the app are denominated in EUR.

const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const eurFormatterCents = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a number as EUR currency, e.g. 15000 -> "15.000 €". */
export function formatEUR(value: number | null | undefined, withCents = false): string {
  const n = Number(value ?? 0);
  return (withCents ? eurFormatterCents : eurFormatter).format(Number.isFinite(n) ? n : 0);
}

/** The currency symbol used across the app. */
export const CURRENCY_SYMBOL = "€";
