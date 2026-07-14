import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOxusDeliverySpaceFeatures,
  mergeSpaceFeaturesEnableOnly,
  parseSpaceFeaturesFromApi,
} from "../../../supabase/functions/_shared/clickupTemplate.ts";
import {
  buildClickupSpaceUpdatePayload,
  isClickupProj143Error,
  mergeFeaturesIntoApiPayload,
  readAdminCanManageFromSpace,
  spaceFeaturesNeedUpdate,
  updateClickupSpaceSafely,
  verifySpaceFeatureUpdates,
} from "../../../supabase/functions/_shared/clickupSpaceUpdate.ts";

const clickupFetch = vi.fn();
vi.mock("../../../supabase/functions/_shared/clickup.ts", () => ({
  clickupFetch: (...args: unknown[]) => clickupFetch(...args),
}));

describe("clickupSpaceUpdate payload", () => {
  const required = buildOxusDeliverySpaceFeatures();

  it("omits admin_can_manage when property is missing", () => {
    const payload = buildClickupSpaceUpdatePayload({
      currentSpace: { name: "Carrotz", private: false, multiple_assignees: true, features: {} },
      approvedFeatureChanges: required,
    });
    expect(payload.admin_can_manage).toBeUndefined();
  });

  it("preserves admin_can_manage true when already enabled", () => {
    const payload = buildClickupSpaceUpdatePayload({
      currentSpace: {
        name: "Carrotz",
        private: false,
        admin_can_manage: true,
        multiple_assignees: true,
        features: {},
      },
      approvedFeatureChanges: required,
    });
    expect(payload.admin_can_manage).toBe(true);
  });

  it("never sets admin_can_manage true when current value is false", () => {
    const payload = buildClickupSpaceUpdatePayload({
      currentSpace: {
        name: "Carrotz",
        private: false,
        admin_can_manage: false,
        multiple_assignees: true,
        features: {},
      },
      approvedFeatureChanges: required,
    });
    expect(payload.admin_can_manage).toBeUndefined();
  });

  it("omits admin_can_manage when omitAdminCanManage is true", () => {
    const payload = buildClickupSpaceUpdatePayload({
      currentSpace: {
        name: "Carrotz",
        admin_can_manage: true,
        features: {},
      },
      approvedFeatureChanges: required,
      omitAdminCanManage: true,
    });
    expect(payload.admin_can_manage).toBeUndefined();
  });

  it("preserves existing feature sub-properties via deep merge", () => {
    const merged = mergeSpaceFeaturesEnableOnly(parseSpaceFeaturesFromApi({}), required);
    const payload = mergeFeaturesIntoApiPayload(
      {
        due_dates: {
          enabled: false,
          start_date: false,
          remap_due_dates: true,
          remap_closed_due_date: true,
        },
        time_tracking: { enabled: false, rollup: true },
      },
      merged,
    );
    expect(payload.due_dates).toMatchObject({
      enabled: true,
      start_date: true,
      remap_due_dates: true,
      remap_closed_due_date: true,
    });
    expect(payload.time_tracking).toMatchObject({ enabled: true, rollup: true });
  });

  it("preserves multiple_assignees when already enabled", () => {
    const payload = buildClickupSpaceUpdatePayload({
      currentSpace: { name: "Space", multiple_assignees: true, features: {} },
      approvedFeatureChanges: required,
      enableMultipleAssignees: true,
    });
    expect(payload.multiple_assignees).toBe(true);
  });

  it("does not force multiple_assignees when not requested", () => {
    const payload = buildClickupSpaceUpdatePayload({
      currentSpace: { name: "Space", multiple_assignees: false, features: {} },
      approvedFeatureChanges: required,
      enableMultipleAssignees: false,
    });
    expect(payload.multiple_assignees).toBe(false);
  });

  it("detects when space features need update", () => {
    const current = {
      name: "Space",
      multiple_assignees: true,
      features: { tags: { enabled: false } },
    };
    expect(spaceFeaturesNeedUpdate(current, required, false)).toBe(true);
  });
});

describe("readAdminCanManageFromSpace", () => {
  it("returns undefined when property is absent", () => {
    expect(readAdminCanManageFromSpace({ name: "x" })).toBeUndefined();
  });

  it("returns true only for explicit true", () => {
    expect(readAdminCanManageFromSpace({ admin_can_manage: true })).toBe(true);
    expect(readAdminCanManageFromSpace({ admin_can_manage: false })).toBe(false);
  });
});

describe("isClickupProj143Error", () => {
  it("detects PROJ_143 and admin manage message", () => {
    expect(
      isClickupProj143Error(
        'ClickUp API PUT /space/1 failed: 403 ECODE: PROJ_143 To let admins manage this space',
      ),
    ).toBe(true);
    expect(isClickupProj143Error("Some other error")).toBe(false);
  });
});

describe("verifySpaceFeatureUpdates", () => {
  const required = buildOxusDeliverySpaceFeatures();

  it("reports enabled automatically only after re-fetch confirms feature", () => {
    const before = parseSpaceFeaturesFromApi({
      time_estimates: { enabled: false },
      tags: { enabled: false },
    });
    const intended = mergeSpaceFeaturesEnableOnly(before, required);
    const result = verifySpaceFeatureUpdates({
      before,
      intended,
      afterSpace: {
        features: {
          time_estimates: { enabled: true },
          tags: { enabled: false },
        },
      },
    });
    expect(result.enabled_automatically).toContain("Time estimates");
    expect(result.requires_manual).toContain("Enable tags in ClickUp Space settings.");
    expect(result.unchanged).toContain("Admin management of private Spaces");
  });
});

describe("updateClickupSpaceSafely PROJ_143 retry", () => {
  const clickup = { apiToken: "token", baseUrl: "https://api.clickup.com/api/v2" };
  const required = buildOxusDeliverySpaceFeatures();

  beforeEach(() => {
    clickupFetch.mockReset();
  });

  it("retries once without admin_can_manage after PROJ_143 and succeeds", async () => {
    const space = {
      name: "Carrotz",
      private: false,
      admin_can_manage: false,
      multiple_assignees: true,
      features: { tags: { enabled: false } },
    };
    const updatedSpace = {
      ...space,
      features: { tags: { enabled: true } },
    };

    clickupFetch
      .mockResolvedValueOnce(space)
      .mockRejectedValueOnce(
        new Error("ClickUp API PUT /space/123 failed: 403 ECODE: PROJ_143 admins manage this space"),
      )
      .mockResolvedValueOnce(space)
      .mockResolvedValueOnce(updatedSpace)
      .mockResolvedValueOnce(updatedSpace);

    const outcome = await updateClickupSpaceSafely(clickup, "123", {
      approvedFeatureChanges: required,
      enableMultipleAssignees: false,
    });

    const putCalls = clickupFetch.mock.calls.filter((call) => call[1] === "/space/123" && call[2]?.method === "PUT");
    expect(putCalls).toHaveLength(2);
    const retryBody = JSON.parse(String(putCalls[1][2]?.body));
    expect(retryBody.admin_can_manage).toBeUndefined();
    expect(outcome.proj143_retry).toBe(true);
    expect(outcome.verification.enabled_automatically).toContain("Tags");
    expect(clickupFetch).toHaveBeenCalledTimes(5);
  });

  it("fails cleanly after corrected retry without infinite retries", async () => {
    const space = {
      name: "Carrotz",
      admin_can_manage: false,
      multiple_assignees: true,
      features: { tags: { enabled: false } },
    };

    clickupFetch
      .mockResolvedValueOnce(space)
      .mockRejectedValueOnce(new Error("ClickUp API PUT /space/123 failed: 403 ECODE: PROJ_143"))
      .mockResolvedValueOnce(space)
      .mockRejectedValueOnce(new Error("ClickUp API PUT /space/123 failed: 403 still blocked"));

    await expect(
      updateClickupSpaceSafely(clickup, "123", {
        approvedFeatureChanges: required,
        enableMultipleAssignees: false,
      }),
    ).rejects.toMatchObject({
      diagnostic_code: "CLICKUP_PROJ_143",
      message: expect.stringContaining("Enterprise-only Space administration setting"),
    });

    const putCalls = clickupFetch.mock.calls.filter((call) => call[1] === "/space/123" && call[2]?.method === "PUT");
    expect(putCalls).toHaveLength(2);
  });

  it("skips update when features already match", async () => {
    const space = {
      name: "Carrotz",
      multiple_assignees: true,
      features: buildOxusDeliverySpaceFeatures(),
    };
    clickupFetch.mockResolvedValueOnce(space);

    const outcome = await updateClickupSpaceSafely(clickup, "123", {
      approvedFeatureChanges: required,
      enableMultipleAssignees: false,
    });

    expect(outcome.skipped).toBe(true);
    expect(clickupFetch).toHaveBeenCalledTimes(1);
  });
});
