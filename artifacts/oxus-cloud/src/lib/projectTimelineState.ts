import type { ProjectStatus } from "@/lib/types";
import {
  addCalendarDays,
  compareDateOnly,
  diffCalendarDays,
  endOfYearDateOnly,
  formatDateOnly,
  formatDateOnlyLong,
  maxDateOnly,
  ordinalFromDateOnly,
  parseDateOnly,
  todayInProductTimezone,
  yearFromDateOnly,
} from "@/lib/projectDates";

export type ProjectTimelineVisualState =
  | "not_scheduled"
  | "incomplete_dates"
  | "invalid_dates"
  | "scheduled"
  | "in_progress"
  | "ongoing"
  | "overdue"
  | "completed";

export interface ProjectTimelineInput {
  startDate: string | null | undefined;
  deadline: string | null | undefined;
  today?: string;
  status?: ProjectStatus | string | null;
  archivedAt?: string | null;
}

export interface ProjectTimelineState {
  state: ProjectTimelineVisualState;
  start_date: string | null;
  deadline: string | null;
  display_end_date: string | null;
  elapsed_percentage: number | null;
  days_total: number | null;
  days_elapsed: number | null;
  days_remaining: number | null;
  days_overdue: number | null;
  label: string;
  show_progress_bar: boolean;
  gantt_schedulable: boolean;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function computeDisplayEndDate(
  startDate: string | null,
  deadline: string | null,
  today: string,
): string | null {
  if (deadline) return deadline;
  if (!startDate) return null;
  const startYear = yearFromDateOnly(startDate)!;
  const todayYear = yearFromDateOnly(today)!;
  const anchor = maxDateOnly(today, startDate);
  const anchorYear = yearFromDateOnly(anchor)!;
  const year = Math.max(anchorYear, startYear, todayYear);
  return endOfYearDateOnly(year);
}

export function getProjectTimelineState(input: ProjectTimelineInput): ProjectTimelineState {
  const today = input.today ?? todayInProductTimezone();
  const start_date = input.startDate?.trim() || null;
  const deadline = input.deadline?.trim() || null;
  const isCompleted = input.status === "completed";

  const base = {
    start_date,
    deadline,
    display_end_date: null as string | null,
    elapsed_percentage: null as number | null,
    days_total: null as number | null,
    days_elapsed: null as number | null,
    days_remaining: null as number | null,
    days_overdue: null as number | null,
    show_progress_bar: false,
    gantt_schedulable: false,
  };

  if (!start_date && !deadline) {
    return {
      ...base,
      state: "not_scheduled",
      label: "Not scheduled",
    };
  }

  if (!start_date && deadline) {
    return {
      ...base,
      state: "incomplete_dates",
      label: "Start date missing",
    };
  }

  if (start_date && deadline && compareDateOnly(deadline, start_date) < 0) {
    return {
      ...base,
      state: "invalid_dates",
      label: "Invalid dates",
    };
  }

  const display_end_date = computeDisplayEndDate(start_date, deadline, today);
  base.display_end_date = display_end_date;
  base.gantt_schedulable = !!start_date;

  if (start_date && !deadline) {
    return {
      ...base,
      state: isCompleted ? "completed" : "ongoing",
      label: isCompleted ? "Completed" : "Ongoing",
    };
  }

  // Both start and deadline exist.
  const days_total = diffCalendarDays(start_date!, deadline!);
  const days_elapsed = diffCalendarDays(start_date!, today);
  const days_remaining = diffCalendarDays(today, deadline!);
  const rawPercent = days_total === 0 ? 100 : (days_elapsed / days_total) * 100;
  const elapsed_percentage = clampPercent(rawPercent);

  if (isCompleted) {
    return {
      ...base,
      state: "completed",
      elapsed_percentage: 100,
      days_total,
      days_elapsed: Math.max(0, days_elapsed),
      days_remaining: 0,
      days_overdue: null,
      label: "Completed",
      show_progress_bar: true,
    };
  }

  if (compareDateOnly(today, start_date!) < 0) {
    return {
      ...base,
      state: "scheduled",
      elapsed_percentage: 0,
      days_total,
      days_elapsed: 0,
      days_remaining: diffCalendarDays(today, deadline!),
      days_overdue: null,
      label: `Starts ${formatDateOnly(start_date)}`,
      show_progress_bar: true,
    };
  }

  if (compareDateOnly(today, deadline!) > 0) {
    const days_overdue = diffCalendarDays(deadline!, today);
    return {
      ...base,
      state: "overdue",
      elapsed_percentage: 100,
      days_total,
      days_elapsed: days_total,
      days_remaining: 0,
      days_overdue,
      label: `Overdue by ${days_overdue} day${days_overdue === 1 ? "" : "s"}`,
      show_progress_bar: true,
    };
  }

  return {
    ...base,
    state: "in_progress",
    elapsed_percentage,
    days_total,
    days_elapsed: Math.max(0, days_elapsed),
    days_remaining: Math.max(0, days_remaining),
    days_overdue: null,
    label: `${elapsed_percentage}%`,
    show_progress_bar: true,
  };
}

export function formatTimelineRange(start: string | null, end: string | null): string {
  if (!start && !end) return "Not scheduled";
  if (start && end) return `${formatDateOnlyLong(start)} – ${formatDateOnlyLong(end)}`;
  if (start) return `Started ${formatDateOnlyLong(start)}`;
  return `Due ${formatDateOnlyLong(end)}`;
}

export function ganttBarOrdinals(timeline: ProjectTimelineState): { start: number; end: number } | null {
  if (!timeline.gantt_schedulable || !timeline.start_date || !timeline.display_end_date) return null;
  const start = ordinalFromDateOnly(timeline.start_date);
  const end = ordinalFromDateOnly(timeline.display_end_date);
  if (start == null || end == null || end < start) return null;
  return { start, end };
}

export function todayOrdinal(today?: string): number {
  return ordinalFromDateOnly(today ?? todayInProductTimezone())!;
}

/** Padding days around the computed Gantt data range. */
export function padGanttRange(min: number, max: number, scale: "week" | "month" | "quarter" | "year"): { min: number; max: number } {
  const pad =
    scale === "week" ? 7 : scale === "month" ? 14 : scale === "quarter" ? 30 : 60;
  return { min: min - pad, max: max + pad };
}

export function ongoingDisplayEndYear(timeline: ProjectTimelineState): number | null {
  if (!timeline.display_end_date || timeline.deadline) return null;
  return yearFromDateOnly(timeline.display_end_date);
}

export { addCalendarDays, formatDateOnly, formatDateOnlyLong, todayInProductTimezone };
