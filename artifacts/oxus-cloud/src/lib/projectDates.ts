/** Product reporting timezone for calendar-day boundaries. */
export const PRODUCT_TIMEZONE = "Europe/Lisbon";

export type DateOnlyParts = { year: number; month: number; day: number };

/** Parse a date-only ISO string (`YYYY-MM-DD`) without UTC midnight shifts. */
export function parseDateOnly(value: string | null | undefined): DateOnlyParts | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Calendar ordinal: whole days since 1970-01-01 (UTC date-only, DST-safe). */
export function dateOnlyOrdinal(parts: DateOnlyParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function ordinalFromDateOnly(value: string | null | undefined): number | null {
  const parts = parseDateOnly(value);
  return parts ? dateOnlyOrdinal(parts) : null;
}

export function formatDateOnly(value: string | null | undefined, locale = "en-US"): string {
  const parts = parseDateOnly(value);
  if (!parts) return "—";
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export function formatDateOnlyLong(value: string | null | undefined, locale = "en-US"): string {
  const parts = parseDateOnly(value);
  if (!parts) return "—";
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

/** Today's calendar date in the product timezone as `YYYY-MM-DD`. */
export function todayInProductTimezone(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PRODUCT_TIMEZONE }).format(now);
}

export function endOfYearDateOnly(year: number): string {
  return `${year}-12-31`;
}

export function yearFromDateOnly(value: string | null | undefined): number | null {
  return parseDateOnly(value)?.year ?? null;
}

/** Inclusive calendar-day difference: `end - start` in whole days. */
export function diffCalendarDays(start: string, end: string): number {
  const a = ordinalFromDateOnly(start);
  const b = ordinalFromDateOnly(end);
  if (a == null || b == null) return 0;
  return b - a;
}

export function addCalendarDays(value: string, days: number): string {
  const parts = parseDateOnly(value);
  if (!parts) return value;
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function compareDateOnly(a: string, b: string): number {
  const oa = ordinalFromDateOnly(a) ?? 0;
  const ob = ordinalFromDateOnly(b) ?? 0;
  return oa - ob;
}

export function maxDateOnly(a: string, b: string): string {
  return compareDateOnly(a, b) >= 0 ? a : b;
}

/** First day of month containing `value`. */
export function startOfMonthDateOnly(value: string): string {
  const parts = parseDateOnly(value);
  if (!parts) return value;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
}

/** Last day of month containing `value`. */
export function endOfMonthDateOnly(value: string): string {
  const parts = parseDateOnly(value);
  if (!parts) return value;
  const last = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
