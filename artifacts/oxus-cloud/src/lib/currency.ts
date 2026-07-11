const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();
const CURRENCY_FORMATTERS_CENTS = new Map<string, Intl.NumberFormat>();

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

function getFormatter(currency: string, withCents: boolean): Intl.NumberFormat {
  const code = currency.toUpperCase();
  const cache = withCents ? CURRENCY_FORMATTERS_CENTS : CURRENCY_FORMATTERS;
  let formatter = cache.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      ...(withCents
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : { maximumFractionDigits: 0 }),
    });
    cache.set(code, formatter);
  }
  return formatter;
}

/** Format a number as EUR currency, e.g. 15000 -> "15.000 €". */
export function formatEUR(value: number | null | undefined, withCents = false): string {
  const n = Number(value ?? 0);
  return (withCents ? eurFormatterCents : eurFormatter).format(Number.isFinite(n) ? n : 0);
}

/** Format a number in the given ISO currency code. */
export function formatCurrency(
  value: number | null | undefined,
  currency = "EUR",
  withCents = false,
): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  const code = (currency || "EUR").toUpperCase();
  if (code === "EUR") return formatEUR(n, withCents);
  return getFormatter(code, withCents).format(n);
}

/** The currency symbol used across the app for EUR defaults. */
export const CURRENCY_SYMBOL = "€";

/** Graceful fallback when EUR conversion is unavailable. */
export const EUR_UNAVAILABLE = "Not available";
