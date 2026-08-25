import { describe, expect, it } from "vitest";
import {
  CLICKUP_TEMPLATE_VERSION,
  detectMissingRequiredStatuses,
  findEquivalentStatus,
  mergeSpaceFeaturesEnableOnly,
  normalizeStatusName,
  OXUS_REQUIRED_STATUSES,
  resolveStatusIntent,
} from "../../../supabase/functions/_shared/clickupTemplate.ts";
import {
  dateToClickupDue,
  dateToClickupStart,
  normalizeTagNames,
  oxusPriorityToClickup,
  parseTimeEstimateInput,
  validateTaskDateRange,
} from "../../../supabase/functions/_shared/clickupTaskFields.ts";

describe("clickupTemplate", () => {
  it("uses template version 1", () => {
    expect(CLICKUP_TEMPLATE_VERSION).toBe(1);
  });

  it("detects missing required statuses case-insensitively", () => {
    const missing = detectMissingRequiredStatuses([
      { status: "to do", type: "open" },
      { status: "in progress", type: "custom" },
      { status: "complete", type: "closed" },
    ]);
    expect(missing).toContain("ON HOLD");
    expect(missing).toContain("REVIEW");
    expect(missing).not.toContain("TO DO");
  });

  it("does not treat on hold variants as separate required statuses", () => {
    const hit = findEquivalentStatus(
      [{ status: "On Hold", type: "custom" }],
      OXUS_REQUIRED_STATUSES.find((s) => s.key === "ON_HOLD")!,
    );
    expect(hit?.status).toBe("On Hold");
    expect(normalizeStatusName("ON HOLD")).toBe(normalizeStatusName("on hold"));
  });

  it("resolves status intent to canonical list status", () => {
    const resolved = resolveStatusIntent(
      [{ status: "IN PROGRESS", type: "custom" }],
      "in progress",
    );
    expect(resolved.exists).toBe(true);
    expect(resolved.matched).toBe("IN PROGRESS");
  });

  it("merges space features without disabling existing enabled flags", () => {
    const merged = mergeSpaceFeaturesEnableOnly(
      {
        due_dates: { enabled: true, start_date: false, remap_due_dates: false, remap_closed_due_date: false },
        time_tracking: { enabled: false },
        tags: { enabled: true },
        time_estimates: { enabled: false },
        checklists: { enabled: true },
        custom_fields: { enabled: true },
        remap_dependencies: { enabled: false },
        dependency_warning: { enabled: false },
        portfolios: { enabled: false },
      },
      {
        due_dates: { enabled: true, start_date: true, remap_due_dates: false, remap_closed_due_date: false },
        time_tracking: { enabled: true },
        tags: { enabled: true },
        time_estimates: { enabled: true },
        checklists: { enabled: true },
        custom_fields: { enabled: true },
        remap_dependencies: { enabled: false },
        dependency_warning: { enabled: false },
        portfolios: { enabled: false },
      },
    );
    expect(merged.due_dates.enabled).toBe(true);
    expect(merged.due_dates.start_date).toBe(true);
    expect(merged.time_tracking.enabled).toBe(true);
    expect(merged.tags.enabled).toBe(true);
  });
});

describe("clickupTaskFields", () => {
  it("maps priority including empty to undefined", () => {
    expect(oxusPriorityToClickup(null)).toBeUndefined();
    expect(oxusPriorityToClickup("high")).toBe(2);
  });

  it("parses friendly estimate strings", () => {
    expect(parseTimeEstimateInput("4h").milliseconds).toBe(4 * 60 * 60000);
    expect(parseTimeEstimateInput("3h 30m").milliseconds).toBe(210 * 60000);
    expect(parseTimeEstimateInput("1d").milliseconds).toBe(8 * 60 * 60000);
    expect(parseTimeEstimateInput("-1h").error).toBeTruthy();
  });

  it("uses timezone-safe date-only conversion", () => {
    const start = dateToClickupStart("2026-07-14", false);
    const due = dateToClickupDue("2026-07-14", false);
    expect(new Date(start).getUTCDate()).toBe(14);
    expect(new Date(due).getUTCDate()).toBe(14);
    expect(due).toBeGreaterThan(start);
  });

  it("rejects due date before start date", () => {
    expect(validateTaskDateRange("2026-07-20", "2026-07-10")).toMatch(/before/i);
  });

  it("normalizes tags without duplicates", () => {
    expect(normalizeTagNames([" Bug ", "bug", "Feature"])).toEqual(["Bug", "Feature"]);
  });
});
