export const REPORTING_TIMEZONE = "Europe/Lisbon";

export function getReportingMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

export function formatReportingMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: REPORTING_TIMEZONE,
  });
}

export function isTimestampInReportingMonth(iso: string | null | undefined, monthKey: string): boolean {
  if (!iso) return false;
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(iso));
  return key.startsWith(monthKey);
}

export function paidTimestampInReportingMonth(
  paidAt: string | null | undefined,
  paidDate: string | null | undefined,
  monthKey: string,
): boolean {
  if (paidAt && isTimestampInReportingMonth(paidAt, monthKey)) return true;
  if (paidDate) {
    const [y, m] = monthKey.split("-");
    return paidDate.startsWith(`${y}-${m}-`);
  }
  return false;
}
