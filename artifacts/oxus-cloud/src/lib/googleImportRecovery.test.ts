import { describe, expect, it } from "vitest";
import {
  classifyGoogleSyncError,
  GOOGLE_IMPORT_MAX_AUTO_RETRIES,
  hasRetryBudget,
  shouldWatchdogSkipImport,
} from "@/lib/googleImportRecovery";

describe("googleImportRecovery", () => {
  it("classifies transient worker failures as recoverable", () => {
    expect(classifyGoogleSyncError("WORKER_INVOKE_FAILED", "fetch failed")).toBe("recoverable");
    expect(classifyGoogleSyncError("INVALID_WORKER_PAYLOAD", "Invalid action")).toBe("fatal");
  });

  it("skips watchdog while a future retry is scheduled", () => {
    expect(shouldWatchdogSkipImport({
      status: "running",
      recovery_status: "retrying",
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    })).toBe(true);
  });

  it("does not skip stale retrying without future retry", () => {
    expect(shouldWatchdogSkipImport({
      status: "running",
      recovery_status: "retrying",
      last_heartbeat_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    })).toBe(false);
  });

  it("tracks retry budget", () => {
    expect(hasRetryBudget(0)).toBe(true);
    expect(hasRetryBudget(GOOGLE_IMPORT_MAX_AUTO_RETRIES)).toBe(false);
  });
});
