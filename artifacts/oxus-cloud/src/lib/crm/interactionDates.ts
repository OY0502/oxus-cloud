/**
 * Display helpers for CRM interaction dates.
 * Semantic past/future eligibility is decided by the backend; this only formats.
 */

import { format, formatDistance, isValid, parseISO } from "date-fns";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return isValid(d) ? d : null;
}

/** Last interaction: never show future relative ("in X minutes"). */
export function formatLastInteractionAt(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return "—";
  if (d.getTime() > now.getTime()) return "—";
  const ageMs = now.getTime() - d.getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (ageMs <= thirtyDays) return formatDistance(d, now, { addSuffix: true });
  return format(d, "MMM d, yyyy");
}

/** Next meeting: only future timestamps. */
export function formatNextMeetingAt(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return "—";
  if (d.getTime() <= now.getTime()) return "—";
  const deltaMs = d.getTime() - now.getTime();
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  if (deltaMs <= fourteenDays) return formatDistance(d, now, { addSuffix: true });
  return format(d, "MMM d, yyyy");
}
