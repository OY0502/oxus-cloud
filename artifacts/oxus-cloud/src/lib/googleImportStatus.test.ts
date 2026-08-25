import { describe, expect, it } from "vitest";
import {
  resolveCanonicalGoogleImportStatus,
  shouldReactivateInterruptedImportRun,
} from "@/lib/googleImportStatus";
import type { GoogleImportRun } from "@/lib/types";

function baseRun(overrides: Partial<GoogleImportRun> = {}): GoogleImportRun {
  return {
    id: "run-1",
    connection_id: "conn-1",
    owner_user_id: "user-1",
    run_type: "initial",
    status: "running",
    progress_stage: "resolving_people",
    sources: ["contacts", "calendar", "gmail"],
    lookback_months: 12,
    settings: {},
    counts: {
      threads_discovered: 845,
      ignored_records: 1377,
      people_updated: 17,
      candidates_created: 439,
    },
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
    updated_at: new Date().toISOString(),
    core_sync_status: "pending",
    enrichment_status: "pending",
    last_heartbeat_at: new Date().toISOString(),
    last_historical_error_code: "MAX_DURATION_EXCEEDED",
    last_historical_error_message: "Root orchestration task exceeded its previous 600-second limit.",
    recovered_at: new Date().toISOString(),
    import_history: [
      { at: "2026-07-12T12:00:00.000Z", event: "interrupted", detail: "Root orchestration task exceeded its previous 600-second limit." },
      { at: "2026-07-13T08:00:00.000Z", event: "recovered", detail: "Import resumed from checkpoint." },
    ],
    ...overrides,
  };
}

describe("resolveCanonicalGoogleImportStatus", () => {
  it("treats active child work over historical root timeout as running", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        status: "timed_out",
        error_code: "MAX_DURATION_EXCEEDED",
        error: "Initial import interrupted",
        progress_stage: "resolving_people",
      }),
      sourceRuns: [{ source: "crm_resolution", status: "running", last_heartbeat_at: new Date().toISOString() }],
      reviewCandidatesPending: 0,
    });

    expect(status.status).toBe("running");
    expect(status.active).toBe(true);
    expect(status.action_required).toBe(false);
    expect(status.show_retry).toBe(false);
    expect(status.banner_severity).toBe("info");
    expect(status.title).toBe("Building your CRM");
    expect(status.historical_interruption?.code).toBe("MAX_DURATION_EXCEEDED");
  });

  it("shows finishing state while core sync finalizes", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        status: "running",
        progress_stage: "completing_core_sync",
        core_sync_status: "running",
        recovery_status: "retrying",
      }),
    });

    expect(status.active).toBe(true);
    expect(status.action_required).toBe(false);
    expect(status.show_retry).toBe(false);
    expect(status.title).toBe("Finishing CRM sync");
  });

  it("shows resuming state during automatic recovery", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        status: "timed_out",
        progress_stage: "completing_core_sync",
        recovery_status: "recovering",
        action_required: false,
        error_code: "STALE_RUN_RECONCILED",
      }),
    });

    expect(status.active).toBe(true);
    expect(status.title).toBe("Resuming CRM sync");
    expect(status.show_retry).toBe(false);
  });

  it("shows amber paused state when interruption is recoverable and no active work exists", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        status: "timed_out",
        progress_stage: "failed",
        error_code: "STALE_RUN_RECONCILED",
        error: "Initial import interrupted",
        last_heartbeat_at: "2026-07-10T10:00:00.000Z",
      }),
    });

    expect(status.status).toBe("paused");
    expect(status.banner_severity).toBe("warning");
    expect(status.show_retry).toBe(true);
    expect(status.title).toBe("Import paused");
  });

  it("shows terminal failure when no checkpoint or active work remains", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        status: "failed",
        progress_stage: "failed",
        error_code: "SYNC_FAILED",
        error: "Google authorization expired",
        counts: {},
        last_heartbeat_at: "2026-07-10T10:00:00.000Z",
      }),
    });

    expect(status.status).toBe("failed");
    expect(status.banner_severity).toBe("error");
    expect(status.action_required).toBe(true);
  });

  it("uses pending review candidates instead of internal candidate counter", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun(),
      reviewCandidatesPending: 3,
    });

    expect(status.progress.internal_candidates_created).toBe(439);
    expect(status.progress.review_candidates_pending).toBe(3);
    expect(status.subtitle).toContain("3 records prepared for review");
  });

  it("shows enrichment-active state after core sync completes", () => {
    const status = resolveCanonicalGoogleImportStatus({
      run: baseRun({
        status: "running",
        progress_stage: "analyzing_relationships",
        core_sync_status: "complete",
        enrichment_status: "running",
      }),
    });

    expect(status.phase).toBe("enrichment");
    expect(status.title).toBe("Google data synced");
    expect(status.subtitle).toContain("Relationship enrichment continues");
  });
});

describe("shouldReactivateInterruptedImportRun", () => {
  it("detects stale terminal status with fresh progressing heartbeat", () => {
    expect(shouldReactivateInterruptedImportRun({
      status: "timed_out",
      error_code: "MAX_DURATION_EXCEEDED",
      error: "timeout",
      progress_stage: "resolving_people",
      last_heartbeat_at: new Date().toISOString(),
    })).toBe(true);
  });
});
