import { describe, expect, it } from "vitest";
import { diffCalendarDays, parseDateOnly, todayInProductTimezone } from "@/lib/projectDates";
import { getProjectTimelineState } from "@/lib/projectTimelineState";

describe("parseDateOnly", () => {
  it("parses YYYY-MM-DD without shifting calendar day", () => {
    expect(parseDateOnly("2026-07-08")).toEqual({ year: 2026, month: 7, day: 8 });
  });
});

describe("diffCalendarDays", () => {
  it("counts inclusive calendar span", () => {
    expect(diffCalendarDays("2026-01-01", "2026-01-01")).toBe(0);
    expect(diffCalendarDays("2026-01-01", "2026-01-02")).toBe(1);
  });

  it("handles leap year end of February", () => {
    expect(diffCalendarDays("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("getProjectTimelineState", () => {
  const today = "2026-07-12";

  it("returns not scheduled when no dates", () => {
    const s = getProjectTimelineState({ startDate: null, deadline: null, today });
    expect(s.state).toBe("not_scheduled");
    expect(s.label).toBe("Not scheduled");
    expect(s.show_progress_bar).toBe(false);
  });

  it("returns ongoing without progress bar when start but no deadline", () => {
    const s = getProjectTimelineState({ startDate: "2026-07-01", deadline: null, today });
    expect(s.state).toBe("ongoing");
    expect(s.label).toBe("Ongoing");
    expect(s.show_progress_bar).toBe(false);
    expect(s.display_end_date).toBe("2026-12-31");
    expect(s.gantt_schedulable).toBe(true);
  });

  it("extends ongoing display through start year when start is in a future year", () => {
    const s = getProjectTimelineState({ startDate: "2027-03-01", deadline: null, today: "2026-07-12" });
    expect(s.display_end_date).toBe("2027-12-31");
  });

  it("calculates elapsed percentage between start and deadline", () => {
    const s = getProjectTimelineState({
      startDate: "2026-07-01",
      deadline: "2026-07-31",
      today: "2026-07-12",
      status: "in-progress",
    });
    expect(s.state).toBe("in_progress");
    expect(s.elapsed_percentage).toBe(37);
    expect(s.show_progress_bar).toBe(true);
  });

  it("clamps to 0% before start", () => {
    const s = getProjectTimelineState({
      startDate: "2026-08-01",
      deadline: "2026-08-31",
      today,
      status: "planning",
    });
    expect(s.state).toBe("scheduled");
    expect(s.elapsed_percentage).toBe(0);
    expect(s.label).toMatch(/Starts/);
  });

  it("marks overdue after deadline", () => {
    const s = getProjectTimelineState({
      startDate: "2026-06-01",
      deadline: "2026-07-01",
      today,
      status: "in-progress",
    });
    expect(s.state).toBe("overdue");
    expect(s.elapsed_percentage).toBe(100);
    expect(s.days_overdue).toBe(11);
  });

  it("marks completed without overdue", () => {
    const s = getProjectTimelineState({
      startDate: "2026-01-01",
      deadline: "2026-02-01",
      today,
      status: "completed",
    });
    expect(s.state).toBe("completed");
    expect(s.label).toBe("Completed");
    expect(s.elapsed_percentage).toBe(100);
  });

  it("flags invalid dates when deadline precedes start", () => {
    const s = getProjectTimelineState({
      startDate: "2026-08-01",
      deadline: "2026-07-01",
      today,
    });
    expect(s.state).toBe("invalid_dates");
    expect(s.gantt_schedulable).toBe(false);
  });

  it("flags incomplete scheduling when deadline without start", () => {
    const s = getProjectTimelineState({ startDate: null, deadline: "2026-09-01", today });
    expect(s.state).toBe("incomplete_dates");
    expect(s.label).toBe("Start date missing");
  });

  it("uses same-day deadline as 100% elapsed on that day", () => {
    const s = getProjectTimelineState({
      startDate: "2026-07-12",
      deadline: "2026-07-12",
      today: "2026-07-12",
      status: "in-progress",
    });
    expect(s.elapsed_percentage).toBe(100);
    expect(s.days_total).toBe(0);
  });
});

describe("todayInProductTimezone", () => {
  it("returns an ISO date string", () => {
    expect(todayInProductTimezone(new Date("2026-07-12T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
