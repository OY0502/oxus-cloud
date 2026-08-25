import { describe, expect, it } from "vitest";
import {
  isSourceEnabled,
  resolveNextBatchAction,
  resolveNextBatchActionAfter,
} from "./googleOrchestrator";

describe("googleOrchestrator v2", () => {
  const baseCtx = {
    sources: ["contacts", "calendar", "gmail"],
    sourceProgress: {},
    flags: { contacts: true, calendar: true, gmail: true },
    status: "running",
    processorVersion: 2,
    coreSyncStatus: "pending",
    enrichmentStatus: "pending",
  };

  it("starts at contacts when nothing completed", () => {
    expect(resolveNextBatchAction(baseCtx)).toBe("contacts_page");
  });

  it("uses resolve_basic_entities after gmail discovery on v2", () => {
    const next = resolveNextBatchAction({
      ...baseCtx,
      sourceProgress: {
        contacts: { completed: true },
        calendar: { completed: true },
        gmail: { discovery_completed: true },
      },
    });
    expect(next).toBe("resolve_basic_entities");
  });

  it("starts enrichment only after core sync completes", () => {
    const next = resolveNextBatchAction({
      ...baseCtx,
      coreSyncStatus: "complete",
      sourceProgress: {
        contacts: { completed: true },
        calendar: { completed: true },
        gmail: { discovery_completed: true, core_metadata_completed: true, completed: true },
        core: { completed: true },
        resolve: { completed: true },
      },
    });
    expect(next).toBe("filter_enrichment_threads");
  });

  it("skips legacy gmail_process_batch on v2", () => {
    const next = resolveNextBatchActionAfter("gmail_discover_page", {
      ...baseCtx,
      sourceProgress: { gmail: { discovery_completed: true } },
    });
    expect(next).toBe("resolve_basic_entities");
  });

  it("respects source flags", () => {
    expect(isSourceEnabled("gmail", { gmail: false })).toBe(false);
    expect(isSourceEnabled("contacts", {})).toBe(true);
  });
});
