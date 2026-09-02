import { describe, expect, it } from "vitest";
import {
  buildInvoicingReport,
  formatDuration,
  monthBounds,
  previousMonthKey,
} from "./projectInvoicing";

describe("project invoicing helpers", () => {
  it("defaults to the previous month across year boundaries", () => {
    expect(previousMonthKey(new Date("2026-09-02T12:00:00Z"))).toBe("2026-08");
    expect(previousMonthKey(new Date("2026-01-02T12:00:00Z"))).toBe("2025-12");
  });

  it("uses an exclusive first-of-next-month boundary", () => {
    expect(monthBounds("2026-08")).toEqual({
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-09-01T00:00:00.000Z",
    });
  });

  it("formats durations and creates a copy-friendly report", () => {
    expect(formatDuration(47.5 * 60 * 60 * 1000)).toBe("47h 30m");
    const report = buildInvoicingReport({
      projectName: "Carrotz",
      periodLabel: "August 2026",
      tasks: [
        {
          id: "1",
          name: "Recurrence implementation",
          description: null,
          status: "Billing",
          status_type: "custom",
          url: null,
          estimate_ms: 48 * 60 * 60 * 1000,
          tracked_ms: 47.5 * 60 * 60 * 1000,
        },
      ],
    });
    expect(report.text).toContain("Hours tracked in August 2026");
    expect(report.text).toContain("47h 30m");
    expect(report.html).toContain("<table");
  });
});
