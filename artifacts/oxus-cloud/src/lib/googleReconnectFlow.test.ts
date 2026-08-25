import { describe, expect, it } from "vitest";
import {
  resolveCanonicalGoogleImportStatus,
} from "@/lib/googleImportStatus";
import {
  shouldWatchdogSkipImport,
  classifyGoogleSyncError,
} from "@/lib/googleImportRecovery";
import type { GoogleImportRun } from "@/lib/types";

function baseRun(overrides: Partial<GoogleImportRun> = {}): GoogleImportRun {
  return {
    id: "run-1",
    connection_id: "conn-1",
    owner_user_id: "user-1",
    run_type: "incremental",
    status: "running",
    progress_stage: "validating_connection",
    sources: ["contacts", "calendar", "gmail"],
    lookback_months: 12,
    settings: {},
    counts: {},
    trigger_run_id: "trigger-root",
    progress_processed: 0,
    progress_total: null,
    progress_percentage: null,
    started_at: "2026-07-13T20:43:20.000Z",
    completed_at: null,
    failed_at: null,
    error: "google-sync-worker failed",
    error_code: "SYNC_FAILED",
    warnings: [],
    created_at: "2026-07-13T20:43:12.000Z",
    updated_at: "2026-07-13T20:43:48.000Z",
    core_sync_status: "pending",
    enrichment_status: "pending",
    recovery_status: "retrying",
    retry_count: 9,
    last_heartbeat_at: "2026-07-13T20:43:48.000Z",
    correlation_id: "corr-1",
    ...overrides,
  };
}

describe("Google reconnect stuck-state semantics", () => {
  it("does not treat stale retrying zombie as active sync", () => {
    const status = resolveCanonicalGoogleImportStatus({ run: baseRun() });
    expect(status.active).toBe(false);
    expect(status.status).not.toBe("running");
  });

  it("treats fresh retrying recovery as active", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        last_heartbeat_at: new Date().toISOString(),
        progress_stage: "syncing_contacts",
      }),
    });
    expect(status.active).toBe(true);
  });

  it("uses incremental wording instead of Building your CRM", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        run_type: "incremental",
        sync_mode: "incremental",
        recovery_status: "idle",
        error: null,
        error_code: null,
        progress_stage: "resolving_people",
        last_heartbeat_at: new Date().toISOString(),
      }),
    });
    expect(status.active).toBe(true);
    expect(status.title).toBe("Updating Google data");
    expect(status.title).not.toBe("Building your CRM");
  });

  it("keeps Building your CRM for genuine initial import", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        run_type: "initial",
        sync_mode: "initial",
        recovery_status: "idle",
        error: null,
        error_code: null,
        progress_stage: "resolving_people",
        last_heartbeat_at: new Date().toISOString(),
      }),
    });
    expect(status.title).toBe("Building your CRM");
  });

  it("watchdog does not protect forever-stale retrying rows", () => {
    expect(shouldWatchdogSkipImport({
      status: "running",
      recovery_status: "retrying",
      last_heartbeat_at: "2026-07-13T20:43:48.000Z",
      retry_count: 9,
    })).toBe(false);
  });

  it("watchdog still protects fresh heartbeats", () => {
    expect(shouldWatchdogSkipImport({
      status: "running",
      recovery_status: "retrying",
      last_heartbeat_at: new Date().toISOString(),
    })).toBe(true);
  });

  it("classifies reconnect interrupt and dispatch failure as fatal", () => {
    expect(classifyGoogleSyncError("GOOGLE_SYNC_INTERRUPTED_BY_RECONNECT")).toBe("fatal");
    expect(classifyGoogleSyncError("GOOGLE_SYNC_DISPATCH_FAILED")).toBe("fatal");
    expect(classifyGoogleSyncError("GOOGLE_SYNC_GENERATION_MISMATCH")).toBe("fatal");
  });
});

describe("isCrediblyActiveImportRun helpers via status resolver", () => {
  it("queued without run id past grace is not active forever", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        status: "queued",
        progress_stage: "queued",
        trigger_run_id: null,
        recovery_status: "idle",
        error: null,
        error_code: null,
        last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }),
    });
    expect(status.active).toBe(false);
  });
});
