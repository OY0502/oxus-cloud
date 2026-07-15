import { describe, expect, it, vi } from "vitest";
import { resolveCanonicalGoogleImportStatus } from "@/lib/googleImportStatus";
import { shouldWatchdogSkipImport } from "@/lib/googleImportRecovery";
import type { GoogleImportRun } from "@/lib/types";

function baseRun(overrides: Partial<GoogleImportRun> = {}): GoogleImportRun {
  return {
    id: "run-1",
    connection_id: "conn-1",
    owner_user_id: "user-1",
    run_type: "initial",
    status: "running",
    progress_stage: "resolving_entities",
    sources: ["contacts", "calendar", "gmail"],
    lookback_months: 12,
    settings: {},
    counts: { people_updated: 17 },
    trigger_run_id: "trigger-root",
    progress_processed: 135,
    progress_total: 845,
    progress_percentage: 16,
    started_at: "2026-07-12T10:00:00.000Z",
    completed_at: null,
    failed_at: null,
    error: null,
    error_code: null,
    warnings: [],
    created_at: "2026-07-12T10:00:00.000Z",
    updated_at: "2026-07-10T10:00:00.000Z",
    core_sync_status: "complete",
    enrichment_status: "skipped",
    last_heartbeat_at: "2026-07-10T10:00:00.000Z",
    last_historical_error_code: "MAX_DURATION_EXCEEDED",
    last_historical_error_message: "Import previously interrupted.",
    recovered_at: "2026-07-13T08:00:00.000Z",
    import_history: [],
    ...overrides,
  };
}

describe("google sync architecture guards", () => {
  it("does not show active sync for stale running import after core sync completed", () => {
    const status = resolveCanonicalGoogleImportStatus({ run: baseRun() });
    expect(status.active).toBe(false);
    expect(status.phase).toBe("complete");
    expect(status.title).toBe("Google Workspace is up to date");
  });

  it("shows active sync only with fresh heartbeat", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        core_sync_status: "pending",
        progress_stage: "resolving_entities",
        last_heartbeat_at: new Date().toISOString(),
      }),
    });
    expect(status.active).toBe(true);
    expect(status.title).toBe("Building your CRM");
  });

  it("watchdog skips fresh active runs", () => {
    expect(shouldWatchdogSkipImport({
      status: "running",
      last_heartbeat_at: new Date().toISOString(),
    })).toBe(true);
  });

  it("watchdog does not skip genuinely stale runs", () => {
    expect(shouldWatchdogSkipImport({
      status: "running",
      last_heartbeat_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    })).toBe(false);
  });

  it("historical interruption is not shown as active progress after completion", () => {
    const status = resolveCanonicalGoogleImportStatus({ run: baseRun() });
    expect(status.active).toBe(false);
    expect(status.historical_interruption?.code).toBe("MAX_DURATION_EXCEEDED");
  });
});

describe("calendar freshness policy constants", () => {
  it("uses 15 minute server-side freshness window", async () => {
    const mod = await import("../../supabase/functions/_shared/googleSyncLease.ts");
    expect(mod.CALENDAR_FRESHNESS_MS).toBe(15 * 60 * 1000);
  });
});

describe("CRM page load must not mutate on status read", () => {
  it("google-connection-status source has no reconcile import on read", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../../supabase/functions/google-connection-status/index.ts", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).not.toContain("reconcileStaleGoogleImportRuns");
  });
});

describe("watchdog schedule", () => {
  it("runs once daily at 03:00 Europe/Lisbon", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../trigger/googleSyncTasks.ts", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).toContain('pattern: "0 3 * * *"');
    expect(source).toContain('timezone: "Europe/Lisbon"');
    expect(source).not.toContain('cron: "*/30 * * * *"');
    expect(source).not.toContain('cron: "*/5 * * * *"');
  });

  it("watchdog logs resource guards", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../server/googleImportReconcile.ts", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).toContain("google_api_calls");
    expect(source).toContain("ai_calls");
    expect(source).toContain("firecrawl_calls");
    expect(source).toContain("[reconcile-stale-google-imports] idle");
  });

  it("manual interrupted-import check is separate from sync latest", async () => {
    const fs = await import("node:fs/promises");
    const settings = await fs.readFile(new URL("../pages/Settings.tsx", import.meta.url), "utf8");
    expect(settings).toContain("Check interrupted imports");
    expect(settings).toContain("useGoogleCheckInterruptedImports");
    const googleConn = await fs.readFile(new URL("../components/crm/GoogleConnection.tsx", import.meta.url), "utf8");
    expect(googleConn).toContain("Sync latest");
    expect(googleConn).not.toContain("Check interrupted imports");
  });
});

describe("Calendar page widget removal", () => {
  it("does not render GoogleConnection on Calendar page", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../pages/Calendar.tsx", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).not.toMatch(/from "@\/components\/crm\/GoogleConnection"/);
    expect(source).toContain("Connect Google Calendar to view and manage your schedule.");
  });
});

describe("useCalendarAutoRefresh no longer calls google-sync-now", () => {
  it("uses google-calendar-refresh endpoint", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../hooks/api.ts", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).toContain("google-calendar-refresh");
    expect(source).not.toMatch(/useCalendarAutoRefresh[\s\S]*google-sync-now/);
  });
});
