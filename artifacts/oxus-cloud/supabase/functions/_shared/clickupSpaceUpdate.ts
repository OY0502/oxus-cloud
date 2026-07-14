import {
  buildOxusDeliverySpaceFeatures,
  mergeSpaceFeaturesEnableOnly,
  parseSpaceFeaturesFromApi,
  type ClickupSpaceFeatures,
} from "./clickupTemplate.ts";
import { clickupFetch } from "./clickup.ts";

async function fetchSpaceRecord(
  clickup: { apiToken: string; baseUrl: string },
  spaceId: string,
): Promise<Record<string, unknown>> {
  return clickupFetch(clickup, `/space/${spaceId}`) as Promise<Record<string, unknown>>;
}

export type ClickupSpaceUpdateVerification = {
  enabled_automatically: string[];
  requires_manual: string[];
  unchanged: string[];
};

export type ClickupSpaceUpdateOutcome = {
  skipped: boolean;
  proj143_retry: boolean;
  verification: ClickupSpaceUpdateVerification;
  warnings: string[];
  diagnostic_code?: string;
};

export class ClickupSpaceUpdateError extends Error {
  readonly diagnostic_code: string;
  readonly partial_outcome?: ClickupSpaceUpdateOutcome;

  constructor(message: string, diagnostic_code: string, partial_outcome?: ClickupSpaceUpdateOutcome) {
    super(message);
    this.name = "ClickupSpaceUpdateError";
    this.diagnostic_code = diagnostic_code;
    this.partial_outcome = partial_outcome;
  }
}

export function isClickupProj143Error(message: string): boolean {
  return /PROJ_143/i.test(message) || /admins manage this space/i.test(message);
}

/** Read admin_can_manage only when ClickUp explicitly returned the property. */
export function readAdminCanManageFromSpace(space: Record<string, unknown>): boolean | undefined {
  if (!Object.prototype.hasOwnProperty.call(space, "admin_can_manage")) return undefined;
  return space.admin_can_manage === true;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function mergeFeatureSection(
  rawSection: unknown,
  updates: Record<string, boolean>,
): Record<string, unknown> {
  const section = cloneRecord(rawSection);
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === "boolean") section[key] = value;
  }
  return section;
}

/** Deep-merge enable-only OXUS feature changes into the raw ClickUp features payload. */
export function mergeFeaturesIntoApiPayload(
  rawFeatures: unknown,
  merged: ClickupSpaceFeatures,
): Record<string, unknown> {
  const base = rawFeatures && typeof rawFeatures === "object" && !Array.isArray(rawFeatures)
    ? JSON.parse(JSON.stringify(rawFeatures)) as Record<string, unknown>
    : {};

  const dueDates = mergeFeatureSection(base.due_dates, {
    enabled: merged.due_dates.enabled,
    start_date: merged.due_dates.start_date,
  });
  base.due_dates = dueDates;
  base.time_tracking = mergeFeatureSection(base.time_tracking, { enabled: merged.time_tracking.enabled });
  base.tags = mergeFeatureSection(base.tags, { enabled: merged.tags.enabled });
  base.time_estimates = mergeFeatureSection(base.time_estimates, { enabled: merged.time_estimates.enabled });
  base.checklists = mergeFeatureSection(base.checklists, { enabled: merged.checklists.enabled });
  base.custom_fields = mergeFeatureSection(base.custom_fields, { enabled: merged.custom_fields.enabled });
  base.remap_dependencies = mergeFeatureSection(base.remap_dependencies, {
    enabled: merged.remap_dependencies.enabled,
  });
  base.dependency_warning = mergeFeatureSection(base.dependency_warning, {
    enabled: merged.dependency_warning.enabled,
  });
  base.portfolios = mergeFeatureSection(base.portfolios, { enabled: merged.portfolios.enabled });

  return base;
}

function resolveMultipleAssignees(
  currentSpace: Record<string, unknown>,
  enableMultipleAssignees: boolean,
): boolean {
  if (currentSpace.multiple_assignees === true) return true;
  return enableMultipleAssignees;
}

export function buildClickupSpaceUpdatePayload(args: {
  currentSpace: Record<string, unknown>;
  approvedFeatureChanges: ClickupSpaceFeatures;
  fallbackSpaceName?: string | null;
  enableMultipleAssignees?: boolean;
  omitAdminCanManage?: boolean;
}): Record<string, unknown> {
  const currentFeatures = parseSpaceFeaturesFromApi(args.currentSpace.features);
  const merged = mergeSpaceFeaturesEnableOnly(currentFeatures, args.approvedFeatureChanges);
  const featuresPayload = mergeFeaturesIntoApiPayload(args.currentSpace.features, merged);

  const payload: Record<string, unknown> = {
    name: typeof args.currentSpace.name === "string"
      ? args.currentSpace.name
      : (args.fallbackSpaceName ?? ""),
    color: typeof args.currentSpace.color === "string" ? args.currentSpace.color : null,
    private: args.currentSpace.private === true,
    multiple_assignees: resolveMultipleAssignees(
      args.currentSpace,
      args.enableMultipleAssignees === true,
    ),
    features: featuresPayload,
  };

  if (!args.omitAdminCanManage) {
    const adminCanManage = readAdminCanManageFromSpace(args.currentSpace);
    if (adminCanManage === true) {
      payload.admin_can_manage = true;
    }
  }

  return payload;
}

export function spaceFeaturesNeedUpdate(
  currentSpace: Record<string, unknown>,
  approvedFeatureChanges: ClickupSpaceFeatures,
  enableMultipleAssignees: boolean,
): boolean {
  const currentFeatures = parseSpaceFeaturesFromApi(currentSpace.features);
  const merged = mergeSpaceFeaturesEnableOnly(currentFeatures, approvedFeatureChanges);
  const featuresChanged = JSON.stringify(currentFeatures) !== JSON.stringify(merged);
  const multipleChanged = enableMultipleAssignees &&
    currentSpace.multiple_assignees !== true;
  return featuresChanged || multipleChanged;
}

export function verifySpaceFeatureUpdates(args: {
  before: ClickupSpaceFeatures;
  intended: ClickupSpaceFeatures;
  afterSpace: Record<string, unknown>;
  beforeMultipleAssignees?: boolean;
  intendedMultipleAssignees?: boolean;
}): ClickupSpaceUpdateVerification {
  const after = parseSpaceFeaturesFromApi(args.afterSpace.features);
  const enabled_automatically: string[] = [];
  const requires_manual: string[] = [];
  const unchanged: string[] = ["Admin management of private Spaces"];

  const checks: Array<{
    label: string;
    before: boolean;
    intended: boolean;
    after: boolean;
    manualHint?: string;
  }> = [
    {
      label: "Due dates",
      before: args.before.due_dates.enabled,
      intended: args.intended.due_dates.enabled,
      after: after.due_dates.enabled,
    },
    {
      label: "Start dates",
      before: args.before.due_dates.start_date,
      intended: args.intended.due_dates.start_date,
      after: after.due_dates.start_date,
    },
    {
      label: "Time estimates",
      before: args.before.time_estimates.enabled,
      intended: args.intended.time_estimates.enabled,
      after: after.time_estimates.enabled,
    },
    {
      label: "Time tracking",
      before: args.before.time_tracking.enabled,
      intended: args.intended.time_tracking.enabled,
      after: after.time_tracking.enabled,
      manualHint: "Enable time tracking in ClickUp Space settings if your workspace plan supports it.",
    },
    {
      label: "Tags",
      before: args.before.tags.enabled,
      intended: args.intended.tags.enabled,
      after: after.tags.enabled,
    },
  ];

  for (const check of checks) {
    if (!check.intended || check.before === check.intended) {
      if (check.before === check.after) unchanged.push(check.label);
      continue;
    }
    if (check.after === check.intended) {
      enabled_automatically.push(check.label);
      continue;
    }
    requires_manual.push(check.manualHint ?? `Enable ${check.label.toLowerCase()} in ClickUp Space settings.`);
  }

  const beforeMultiple = args.beforeMultipleAssignees === true;
  const intendedMultiple = args.intendedMultipleAssignees === true;
  const afterMultiple = args.afterSpace.multiple_assignees === true;
  if (intendedMultiple && !beforeMultiple) {
    if (afterMultiple) enabled_automatically.push("Multiple assignees");
    else requires_manual.push("Enable multiple assignees in ClickUp Space settings.");
  } else if (beforeMultiple && afterMultiple) {
    unchanged.push("Multiple assignees");
  }

  return { enabled_automatically, requires_manual, unchanged };
}

export async function updateClickupSpaceSafely(
  clickup: { apiToken: string; baseUrl: string },
  spaceId: string,
  args: {
    fallbackSpaceName?: string | null;
    enableMultipleAssignees?: boolean;
    approvedFeatureChanges?: ClickupSpaceFeatures;
  },
): Promise<ClickupSpaceUpdateOutcome> {
  const approvedFeatureChanges = args.approvedFeatureChanges ?? buildOxusDeliverySpaceFeatures();
  const enableMultipleAssignees = args.enableMultipleAssignees === true;

  let currentSpace = await fetchSpaceRecord(clickup, spaceId);
  const beforeFeatures = parseSpaceFeaturesFromApi(currentSpace.features);
  const beforeMultipleAssignees = currentSpace.multiple_assignees === true;
  const intendedFeatures = mergeSpaceFeaturesEnableOnly(beforeFeatures, approvedFeatureChanges);

  if (!spaceFeaturesNeedUpdate(currentSpace, approvedFeatureChanges, enableMultipleAssignees)) {
    return {
      skipped: true,
      proj143_retry: false,
      verification: {
        enabled_automatically: [],
        requires_manual: [],
        unchanged: [
          "Admin management of private Spaces",
          "Due dates",
          "Start dates",
          "Time estimates",
          "Time tracking",
          "Tags",
        ],
      },
      warnings: [],
    };
  }

  const putSpace = async (omitAdminCanManage: boolean) => {
    const payload = buildClickupSpaceUpdatePayload({
      currentSpace,
      approvedFeatureChanges,
      fallbackSpaceName: args.fallbackSpaceName,
      enableMultipleAssignees,
      omitAdminCanManage,
    });
    await clickupFetch(clickup, `/space/${spaceId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  };

  let proj143_retry = false;
  const warnings: string[] = [];

  try {
    await putSpace(false);
  } catch (firstError) {
    const message = (firstError as Error).message;
    if (!isClickupProj143Error(message)) throw firstError;

    currentSpace = await fetchSpaceRecord(clickup, spaceId);
    proj143_retry = true;
    warnings.push(
      "ClickUp rejected an Enterprise-only Space administration setting. OXUS preserved that setting unchanged.",
    );

    try {
      await putSpace(true);
    } catch (retryError) {
      throw new ClickupSpaceUpdateError(
        "ClickUp rejected an Enterprise-only Space administration setting. OXUS left that setting unchanged, but the remaining setup update could not be completed.",
        "CLICKUP_PROJ_143",
      );
    }
  }

  const afterSpace = await fetchSpaceRecord(clickup, spaceId);
  const verification = verifySpaceFeatureUpdates({
    before: beforeFeatures,
    intended: intendedFeatures,
    afterSpace,
    beforeMultipleAssignees,
    intendedMultipleAssignees: enableMultipleAssignees || beforeMultipleAssignees,
  });

  return {
    skipped: false,
    proj143_retry,
    verification,
    warnings,
    diagnostic_code: proj143_retry ? "CLICKUP_PROJ_143_RECOVERED" : undefined,
  };
}
