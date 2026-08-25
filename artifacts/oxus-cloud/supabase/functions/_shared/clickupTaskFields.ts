/** Shared ClickUp native task field normalization (dates, estimates, priority, tags). */

export type OxusPriority = "urgent" | "high" | "medium" | "low" | null;

export const CLICKUP_PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent", clickup_value: 1 },
  { value: "high", label: "High", clickup_value: 2 },
  { value: "medium", label: "Normal", clickup_value: 3 },
  { value: "low", label: "Low", clickup_value: 4 },
] as const;

const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export function normalizeOxusPriority(value: unknown): OxusPriority {
  if (value === null || value === undefined || value === "") return null;
  if (value === "urgent" || value === "high" || value === "medium" || value === "low") return value;
  return null;
}

export function oxusPriorityToClickup(priority: OxusPriority | string | null | undefined): number | undefined {
  if (priority === null || priority === undefined || priority === "") return undefined;
  return PRIORITY_MAP[String(priority)] ?? undefined;
}

export function dateToClickupStart(dateStr: string, startDateTime = false): number {
  if (startDateTime) return new Date(dateStr).getTime();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (match) {
    const [, y, m, d] = match;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  }
  return new Date(dateStr).getTime();
}

/** Date-only due dates use UTC end-of-day to avoid timezone day shifts in ClickUp. */
export function dateToClickupDue(dateStr: string, dueDateTime = false): number {
  if (dueDateTime) return new Date(dateStr).getTime();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (match) {
    const [, y, m, d] = match;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);
  }
  return new Date(dateStr).getTime();
}

export function validateTaskDateRange(startDate: string | null | undefined, dueDate: string | null | undefined): string | null {
  if (!startDate?.trim() || !dueDate?.trim()) return null;
  const start = dateToClickupStart(startDate, false);
  const due = dateToClickupDue(dueDate, false);
  if (due < start) return "Due date cannot be before start date.";
  return null;
}

export function minutesToClickupTimeEstimate(minutes: number | null | undefined): number | undefined {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  return Math.round(minutes * 60000);
}

export function millisecondsToEstimatePreview(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 8));
  const hours = Math.floor((totalMinutes % (60 * 8)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.join(" ") || "0m";
}

const ESTIMATE_TOKEN = /(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/gi;

export function parseTimeEstimateInput(input: string): { milliseconds?: number; preview?: string; error?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  if (/-/.test(trimmed)) return { error: "Time estimate cannot be negative." };

  let totalMinutes = 0;
  let matched = false;
  for (const token of trimmed.matchAll(ESTIMATE_TOKEN)) {
    matched = true;
    const amount = Number(token[1]);
    if (!Number.isFinite(amount) || amount < 0) return { error: "Time estimate cannot be negative." };
    const unit = token[2].toLowerCase();
    if (unit.startsWith("d")) totalMinutes += amount * 8 * 60;
    else if (unit.startsWith("h")) totalMinutes += amount * 60;
    else totalMinutes += amount;
  }

  if (!matched) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      totalMinutes = asNumber;
      matched = true;
    }
  }

  if (!matched) return { error: 'Invalid time estimate. Use formats like "30m", "2h", "3h 30m", or "1d".' };
  if (totalMinutes <= 0) return { error: "Time estimate must be greater than zero." };

  const ms = Math.round(totalMinutes * 60000);
  return { milliseconds: ms, preview: millisecondsToEstimatePreview(ms) };
}

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const normalized = normalizeTagName(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function matchExistingTags(requested: string[], available: string[]): {
  matched: string[];
  missing: string[];
} {
  const byLower = new Map(available.map((tag) => [tag.toLowerCase(), tag]));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const tag of normalizeTagNames(requested)) {
    const hit = byLower.get(tag.toLowerCase());
    if (hit) matched.push(hit);
    else missing.push(tag);
  }
  return { matched, missing };
}
