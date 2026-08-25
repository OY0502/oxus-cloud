import {
  addCalendarDays,
  dateOnlyOrdinal,
  endOfMonthDateOnly,
  endOfYearDateOnly,
  formatDateOnly,
  ordinalFromDateOnly,
  parseDateOnly,
  startOfMonthDateOnly,
  todayInProductTimezone,
  yearFromDateOnly,
} from "@/lib/projectDates";

export type GanttScale = "week" | "month" | "quarter" | "year";

export const GANTT_SCALE_STORAGE_KEY = "oxus:projects:gantt-scale";
export const PROJECTS_VIEW_STORAGE_KEY = "oxus:projects:view";

export const GANTT_SCALE_OPTIONS: { value: GanttScale; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export interface GanttCanvas {
  start: number;
  end: number;
}

export interface GanttHeaderCell {
  key: string;
  label: string;
  subLabel?: string;
  startOrdinal: number;
  endOrdinal: number;
  isWeekend?: boolean;
  isToday?: boolean;
}

export interface GanttMonthBand {
  key: string;
  label: string;
  startOrdinal: number;
  endOrdinal: number;
}

const MIN_PX_PER_DAY: Record<GanttScale, number> = {
  week: 44,
  month: 24,
  quarter: 8,
  year: 4,
};

export function ganttPixelsPerDay(scale: GanttScale): number {
  return MIN_PX_PER_DAY[scale];
}

export function readGanttScale(): GanttScale {
  if (typeof window === "undefined") return "month";
  const raw = localStorage.getItem(GANTT_SCALE_STORAGE_KEY);
  if (raw === "week" || raw === "month" || raw === "quarter" || raw === "year") return raw;
  return "month";
}

export function writeGanttScale(scale: GanttScale): void {
  localStorage.setItem(GANTT_SCALE_STORAGE_KEY, scale);
}

export function readProjectsView(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PROJECTS_VIEW_STORAGE_KEY);
}

export function writeProjectsView(view: string): void {
  localStorage.setItem(PROJECTS_VIEW_STORAGE_KEY, view);
}

function ordinalToDateOnly(ordinal: number): string {
  const ms = ordinal * 86_400_000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthName(parts: { year: number; month: number; day: number }, style: "short" | "long" = "short"): string {
  return new Date(parts.year, parts.month - 1, parts.day).toLocaleDateString("en-US", { month: style });
}

function dayOfWeekShort(ordinal: number): string {
  const parts = parseDateOnly(ordinalToDateOnly(ordinal))!;
  return new Date(parts.year, parts.month - 1, parts.day).toLocaleDateString("en-US", { weekday: "short" });
}

/** ISO weekday: Mon=1 … Sun=7 */
function isoWeekday(ordinal: number): number {
  const dow = new Date(ordinal * 86_400_000).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Monday on or before this ordinal. */
export function startOfWeekMondayOrdinal(ordinal: number): number {
  return ordinal - (isoWeekday(ordinal) - 1);
}

/** Sunday on or after this ordinal. */
export function endOfWeekSundayOrdinal(ordinal: number): number {
  return ordinal + (7 - isoWeekday(ordinal));
}

function isWeekendOrdinal(ordinal: number): boolean {
  const wd = isoWeekday(ordinal);
  return wd === 6 || wd === 7;
}

export function ganttCanvasSpanDays(canvas: GanttCanvas): number {
  return canvas.end - canvas.start + 1;
}

export function ganttCanvasWidth(canvas: GanttCanvas, scale: GanttScale): number {
  return ganttCanvasSpanDays(canvas) * ganttPixelsPerDay(scale);
}

/** Scrollable year canvas, extended when project bars fall outside the current year. */
export function computeGanttCanvas(
  scale: GanttScale,
  today = todayInProductTimezone(),
  dataMin?: number | null,
  dataMax?: number | null,
): GanttCanvas {
  const todayOrd = dateOnlyOrdinal(parseDateOnly(today)!);
  const year = yearFromDateOnly(today)!;
  let yearStart = ordinalFromDateOnly(`${year}-01-01`)!;
  let yearEnd = ordinalFromDateOnly(endOfYearDateOnly(year))!;

  if (dataMin != null) {
    const dataYear = yearFromDateOnly(ordinalToDateOnly(dataMin))!;
    if (dataYear < year) yearStart = ordinalFromDateOnly(`${dataYear}-01-01`)!;
  }
  if (dataMax != null) {
    const dataYear = yearFromDateOnly(ordinalToDateOnly(dataMax))!;
    if (dataYear > year) yearEnd = ordinalFromDateOnly(endOfYearDateOnly(dataYear))!;
  }

  let start = startOfWeekMondayOrdinal(yearStart);
  let end = endOfWeekSundayOrdinal(yearEnd);

  if (dataMin != null) start = Math.min(start, startOfWeekMondayOrdinal(dataMin) - 7);
  if (dataMax != null) end = Math.max(end, endOfWeekSundayOrdinal(dataMax) + 7);

  // Keep today inside the canvas even if data is sparse.
  start = Math.min(start, startOfWeekMondayOrdinal(todayOrd) - 14);
  end = Math.max(end, endOfWeekSundayOrdinal(todayOrd) + 14);

  return { start, end };
}

function formatWeekRangeMonSun(weekMonday: number): string {
  const weekSunday = weekMonday + 6;
  const startParts = parseDateOnly(ordinalToDateOnly(weekMonday))!;
  const endParts = parseDateOnly(ordinalToDateOnly(weekSunday))!;
  if (startParts.month === endParts.month) {
    return `${monthName(startParts)} ${startParts.day}–${endParts.day}`;
  }
  return `${monthName(startParts)} ${startParts.day} – ${monthName(endParts)} ${endParts.day}`;
}

export function buildGanttMonthBands(canvas: GanttCanvas, scale: GanttScale): GanttMonthBand[] {
  if (scale !== "month") return [];
  const bands: GanttMonthBand[] = [];
  let cursor = canvas.start;

  while (cursor <= canvas.end) {
    const iso = ordinalToDateOnly(cursor);
    const monthEnd = endOfMonthDateOnly(iso);
    const monthEndOrd = dateOnlyOrdinal(parseDateOnly(monthEnd)!);
    const bandEnd = Math.min(monthEndOrd, canvas.end);
    const parts = parseDateOnly(iso)!;
    bands.push({
      key: `${iso}-band`,
      label: `${monthName(parts, "long")} ${parts.year}`,
      startOrdinal: cursor,
      endOrdinal: bandEnd,
    });
    cursor = bandEnd + 1;
  }
  return bands;
}

export function buildGanttHeaders(
  canvas: GanttCanvas,
  scale: GanttScale,
  today = todayInProductTimezone(),
): GanttHeaderCell[] {
  const todayOrd = dateOnlyOrdinal(parseDateOnly(today)!);
  const cells: GanttHeaderCell[] = [];

  if (scale === "week") {
    for (let ord = canvas.start; ord <= canvas.end; ord++) {
      const iso = ordinalToDateOnly(ord);
      const parts = parseDateOnly(iso)!;
      cells.push({
        key: iso,
        label: String(parts.day),
        subLabel: dayOfWeekShort(ord),
        startOrdinal: ord,
        endOrdinal: ord,
        isWeekend: isWeekendOrdinal(ord),
        isToday: ord === todayOrd,
      });
    }
    return cells;
  }

  if (scale === "month") {
    let weekMonday = startOfWeekMondayOrdinal(canvas.start);

    while (weekMonday <= canvas.end) {
      const weekSunday = weekMonday + 6;
      const cellStart = Math.max(weekMonday, canvas.start);
      const cellEnd = Math.min(weekSunday, canvas.end);
      const containsToday = todayOrd >= weekMonday && todayOrd <= weekSunday;

      cells.push({
        key: `week-${weekMonday}`,
        label: formatWeekRangeMonSun(weekMonday),
        startOrdinal: cellStart,
        endOrdinal: cellEnd,
        isToday: containsToday,
      });
      weekMonday += 7;
    }
    return cells;
  }

  if (scale === "quarter") {
    let cursor = canvas.start;
    while (cursor <= canvas.end) {
      const iso = ordinalToDateOnly(cursor);
      const parts = parseDateOnly(iso)!;
      const monthEnd = endOfMonthDateOnly(iso);
      const monthEndOrd = dateOnlyOrdinal(parseDateOnly(monthEnd)!);
      const cellEnd = Math.min(monthEndOrd, canvas.end);
      cells.push({
        key: `${iso}-m`,
        label: monthName(parts),
        subLabel: String(parts.year),
        startOrdinal: cursor,
        endOrdinal: cellEnd,
        isToday: todayOrd >= cursor && todayOrd <= cellEnd,
      });
      cursor = cellEnd + 1;
    }
    return cells;
  }

  let cursor = canvas.start;
  while (cursor <= canvas.end) {
    const iso = ordinalToDateOnly(cursor);
    const parts = parseDateOnly(iso)!;
    const monthStart = startOfMonthDateOnly(iso);
    const monthEnd = endOfMonthDateOnly(iso);
    const startOrd = dateOnlyOrdinal(parseDateOnly(monthStart)!);
    const monthEndOrd = dateOnlyOrdinal(parseDateOnly(monthEnd)!);
    const cellEnd = Math.min(monthEndOrd, canvas.end);
    cells.push({
      key: `${monthStart}-y`,
      label: monthName(parseDateOnly(monthStart)!, "short"),
      subLabel: parts.month === 1 ? String(parts.year) : undefined,
      startOrdinal: Math.max(startOrd, canvas.start),
      endOrdinal: cellEnd,
      isToday: todayOrd >= startOrd && todayOrd <= cellEnd,
    });
    cursor = cellEnd + 1;
  }
  return cells;
}

export function headerCellWidth(cell: GanttHeaderCell | GanttMonthBand, scale: GanttScale): number {
  const days = cell.endOrdinal - cell.startOrdinal + 1;
  return days * ganttPixelsPerDay(scale);
}

export function buildDayGridLines(canvas: GanttCanvas, scale: GanttScale, today = todayInProductTimezone()): GanttHeaderCell[] {
  if (scale !== "week" && scale !== "month") return [];
  const todayOrd = dateOnlyOrdinal(parseDateOnly(today)!);
  const lines: GanttHeaderCell[] = [];
  for (let ord = canvas.start; ord <= canvas.end; ord++) {
    lines.push({
      key: `grid-${ord}`,
      label: "",
      startOrdinal: ord,
      endOrdinal: ord,
      isWeekend: isWeekendOrdinal(ord),
      isToday: ord === todayOrd,
    });
  }
  return lines;
}

export function barGeometry(
  barStart: number,
  barEnd: number,
  canvas: GanttCanvas,
  scale: GanttScale,
): { left: number; width: number; visible: boolean } {
  const px = ganttPixelsPerDay(scale);
  if (barEnd < canvas.start || barStart > canvas.end) {
    return { left: 0, width: 0, visible: false };
  }
  const visStart = Math.max(barStart, canvas.start);
  const visEnd = Math.min(barEnd, canvas.end);
  const left = (visStart - canvas.start) * px;
  const width = Math.max(4, (visEnd - visStart + 1) * px);
  return { left, width, visible: true };
}

export function todayMarkerLeft(canvas: GanttCanvas, scale: GanttScale, today = todayInProductTimezone()): number | null {
  const todayOrd = dateOnlyOrdinal(parseDateOnly(today)!);
  if (todayOrd < canvas.start || todayOrd > canvas.end) return null;
  const px = ganttPixelsPerDay(scale);
  return (todayOrd - canvas.start) * px + px / 2;
}

/** Pixel offset for scrolling to a given ordinal (centers roughly in view). */
export function scrollLeftForOrdinal(
  ordinal: number,
  canvas: GanttCanvas,
  scale: GanttScale,
  viewportWidth: number,
): number {
  const px = ganttPixelsPerDay(scale);
  const marker = (ordinal - canvas.start) * px;
  return Math.max(0, marker - viewportWidth * 0.35);
}

export { ordinalToDateOnly, formatDateOnly, addCalendarDays };
