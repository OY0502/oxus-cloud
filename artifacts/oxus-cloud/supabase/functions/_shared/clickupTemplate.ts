/** Canonical OXUS ClickUp Delivery Template — single source of truth for Space setup. */

export const CLICKUP_DELIVERY_TEMPLATE_NAME = "OXUS Delivery Template";
export const CLICKUP_TEMPLATE_VERSION = 1;

export const OXUS_CLICKUP_FOLDER_NAME = "Delivery";
export const OXUS_CLICKUP_LIST_NAME = "Tasks";

export type ClickupTemplateStatusDef = {
  key: string;
  label: string;
  aliases: string[];
  type: "open" | "closed" | "custom";
};

/** Baseline delivery workflow statuses (case-insensitive match against ClickUp). */
export const OXUS_REQUIRED_STATUSES: ClickupTemplateStatusDef[] = [
  { key: "TO_DO", label: "TO DO", aliases: ["to do", "todo", "to-do"], type: "open" },
  { key: "IN_PROGRESS", label: "IN PROGRESS", aliases: ["in progress", "in-progress", "inprogress"], type: "custom" },
  { key: "ON_HOLD", label: "ON HOLD", aliases: ["on hold", "on-hold", "onhold"], type: "custom" },
  { key: "REVIEW", label: "REVIEW", aliases: ["review", "in review", "in-review"], type: "custom" },
  { key: "COMPLETE", label: "COMPLETE", aliases: ["complete", "done", "closed"], type: "closed" },
];

export type ClickupSpaceFeatures = {
  due_dates: {
    enabled: boolean;
    start_date: boolean;
    remap_due_dates: boolean;
    remap_closed_due_date: boolean;
  };
  time_tracking: { enabled: boolean };
  tags: { enabled: boolean };
  time_estimates: { enabled: boolean };
  checklists: { enabled: boolean };
  custom_fields: { enabled: boolean };
  remap_dependencies: { enabled: boolean };
  dependency_warning: { enabled: boolean };
  portfolios: { enabled: boolean };
};

export function buildOxusDeliverySpaceFeatures(): ClickupSpaceFeatures {
  return {
    due_dates: {
      enabled: true,
      start_date: true,
      remap_due_dates: false,
      remap_closed_due_date: false,
    },
    time_tracking: { enabled: true },
    tags: { enabled: true },
    time_estimates: { enabled: true },
    checklists: { enabled: true },
    custom_fields: { enabled: true },
    remap_dependencies: { enabled: false },
    dependency_warning: { enabled: false },
    portfolios: { enabled: false },
  };
}

export function buildOxusCreateSpacePayload(spaceName: string): Record<string, unknown> {
  return {
    name: spaceName,
    multiple_assignees: true,
    features: buildOxusDeliverySpaceFeatures(),
  };
}

export type ClickupStatusRow = {
  status: string;
  type?: string;
  orderindex?: number;
  color?: string;
};

export function normalizeStatusName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findEquivalentStatus(
  statuses: ClickupStatusRow[],
  def: ClickupTemplateStatusDef,
): ClickupStatusRow | undefined {
  const aliases = new Set(def.aliases.map(normalizeStatusName));
  return statuses.find((row) => aliases.has(normalizeStatusName(row.status)));
}

export function detectMissingRequiredStatuses(statuses: ClickupStatusRow[]): string[] {
  const missing: string[] = [];
  for (const def of OXUS_REQUIRED_STATUSES) {
    if (!findEquivalentStatus(statuses, def)) missing.push(def.label);
  }
  return missing;
}

export function resolveStatusIntent(
  statuses: ClickupStatusRow[],
  intent: string | null | undefined,
): { matched?: string; exists: boolean } {
  const trimmed = (intent ?? "").trim();
  if (!trimmed) return { exists: false };

  const direct = statuses.find((s) => normalizeStatusName(s.status) === normalizeStatusName(trimmed));
  if (direct) return { matched: direct.status, exists: true };

  for (const def of OXUS_REQUIRED_STATUSES) {
    const aliases = new Set([normalizeStatusName(def.label), ...def.aliases.map(normalizeStatusName)]);
    if (aliases.has(normalizeStatusName(trimmed))) {
      const hit = findEquivalentStatus(statuses, def);
      if (hit) return { matched: hit.status, exists: true };
    }
  }
  return { exists: false };
}

export type ClickupFeatureSnapshot = {
  due_dates?: { enabled?: boolean; start_date?: boolean };
  time_tracking?: { enabled?: boolean };
  tags?: { enabled?: boolean };
  time_estimates?: { enabled?: boolean };
  multiple_assignees?: { enabled?: boolean };
};

export function readSpaceFeatureSnapshot(features: unknown): ClickupFeatureSnapshot {
  if (!features || typeof features !== "object") return {};
  return features as ClickupFeatureSnapshot;
}

export function featureEnabled(snapshot: ClickupFeatureSnapshot, key: keyof ClickupSpaceFeatures): boolean {
  const row = snapshot[key as keyof ClickupFeatureSnapshot];
  if (!row || typeof row !== "object") return false;
  return (row as { enabled?: boolean }).enabled === true;
}

export function startDatesEnabled(snapshot: ClickupFeatureSnapshot): boolean {
  return snapshot.due_dates?.enabled === true && snapshot.due_dates?.start_date === true;
}

export function mergeSpaceFeaturesEnableOnly(
  current: ClickupSpaceFeatures,
  required: ClickupSpaceFeatures,
): ClickupSpaceFeatures {
  return {
    due_dates: {
      enabled: current.due_dates.enabled || required.due_dates.enabled,
      start_date: current.due_dates.start_date || required.due_dates.start_date,
      remap_due_dates: current.due_dates.remap_due_dates,
      remap_closed_due_date: current.due_dates.remap_closed_due_date,
    },
    time_tracking: { enabled: current.time_tracking.enabled || required.time_tracking.enabled },
    tags: { enabled: current.tags.enabled || required.tags.enabled },
    time_estimates: { enabled: current.time_estimates.enabled || required.time_estimates.enabled },
    checklists: { enabled: current.checklists.enabled || required.checklists.enabled },
    custom_fields: { enabled: current.custom_fields.enabled || required.custom_fields.enabled },
    remap_dependencies: { enabled: current.remap_dependencies.enabled },
    dependency_warning: { enabled: current.dependency_warning.enabled },
    portfolios: { enabled: current.portfolios.enabled },
  };
}

function readFeatureBool(section: unknown, key: string, fallback: boolean): boolean {
  if (!section || typeof section !== "object") return fallback;
  const val = (section as Record<string, unknown>)[key];
  return typeof val === "boolean" ? val : fallback;
}

/** Read Space features from ClickUp API responses without OXUS template defaults. */
export function parseSpaceFeaturesFromApi(raw: unknown): ClickupSpaceFeatures {
  const f = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const section = (name: keyof ClickupSpaceFeatures) => f[name];

  return {
    due_dates: {
      enabled: readFeatureBool(section("due_dates"), "enabled", false),
      start_date: readFeatureBool(section("due_dates"), "start_date", false),
      remap_due_dates: readFeatureBool(section("due_dates"), "remap_due_dates", false),
      remap_closed_due_date: readFeatureBool(section("due_dates"), "remap_closed_due_date", false),
    },
    time_tracking: { enabled: readFeatureBool(section("time_tracking"), "enabled", false) },
    tags: { enabled: readFeatureBool(section("tags"), "enabled", false) },
    time_estimates: { enabled: readFeatureBool(section("time_estimates"), "enabled", false) },
    checklists: { enabled: readFeatureBool(section("checklists"), "enabled", false) },
    custom_fields: { enabled: readFeatureBool(section("custom_fields"), "enabled", false) },
    remap_dependencies: { enabled: readFeatureBool(section("remap_dependencies"), "enabled", false) },
    dependency_warning: { enabled: readFeatureBool(section("dependency_warning"), "enabled", false) },
    portfolios: { enabled: readFeatureBool(section("portfolios"), "enabled", false) },
  };
}

/** @deprecated Prefer parseSpaceFeaturesFromApi when reading current ClickUp Space state. */
export function parseSpaceFeatures(raw: unknown): ClickupSpaceFeatures {
  const required = buildOxusDeliverySpaceFeatures();
  const f = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const section = (name: keyof ClickupSpaceFeatures) => f[name];

  return {
    due_dates: {
      enabled: readFeatureBool(section("due_dates"), "enabled", required.due_dates.enabled),
      start_date: readFeatureBool(section("due_dates"), "start_date", required.due_dates.start_date),
      remap_due_dates: readFeatureBool(section("due_dates"), "remap_due_dates", required.due_dates.remap_due_dates),
      remap_closed_due_date: readFeatureBool(
        section("due_dates"),
        "remap_closed_due_date",
        required.due_dates.remap_closed_due_date,
      ),
    },
    time_tracking: { enabled: readFeatureBool(section("time_tracking"), "enabled", false) },
    tags: { enabled: readFeatureBool(section("tags"), "enabled", false) },
    time_estimates: { enabled: readFeatureBool(section("time_estimates"), "enabled", false) },
    checklists: { enabled: readFeatureBool(section("checklists"), "enabled", true) },
    custom_fields: { enabled: readFeatureBool(section("custom_fields"), "enabled", true) },
    remap_dependencies: { enabled: readFeatureBool(section("remap_dependencies"), "enabled", false) },
    dependency_warning: { enabled: readFeatureBool(section("dependency_warning"), "enabled", false) },
    portfolios: { enabled: readFeatureBool(section("portfolios"), "enabled", false) },
  };
}

export type ClickupSetupCapabilityAudit = {
  statuses: { available: boolean; missing: string[]; present: string[] };
  assignees: { available: boolean; member_count: number; multiple_assignees: boolean };
  start_date: { available: boolean; manual_step?: string };
  due_date: { available: boolean };
  priority: { available: boolean };
  time_estimate: { available: boolean; manual_step?: string };
  time_tracking: { available: boolean; manual_step?: string };
  tags: { available: boolean; manual_step?: string };
};

export type ClickupSetupAuditResult = {
  status: "configured" | "needs_update" | "missing_required" | "access_required" | "unverified";
  template_version: number;
  applied_template_version: number | null;
  template_name: string;
  space: { exists: boolean; id?: string; name?: string };
  folder: { exists: boolean; id?: string; name?: string };
  list: { exists: boolean; id?: string; name?: string };
  capabilities: ClickupSetupCapabilityAudit;
  warnings: string[];
  manual_steps: string[];
};

export function deriveSetupStatus(audit: ClickupSetupAuditResult): ClickupSetupAuditResult["status"] {
  if (!audit.space.exists || !audit.folder.exists || !audit.list.exists) return "missing_required";

  const caps = audit.capabilities;
  const featureGaps =
    !caps.start_date.available ||
    !caps.due_date.available ||
    !caps.time_estimate.available ||
    !caps.time_tracking.available ||
    !caps.tags.available;

  const statusGaps = caps.statuses.missing.length > 0;

  if (featureGaps || statusGaps) {
    if (
      audit.manual_steps.length > 0 &&
      caps.statuses.missing.length > 0 &&
      caps.time_tracking.available &&
      caps.tags.available &&
      caps.time_estimate.available
    ) {
      return "needs_update";
    }
    return featureGaps || statusGaps ? "needs_update" : "configured";
  }
  return "configured";
}

export const STATUS_MANUAL_SETUP_INSTRUCTION =
  "In ClickUp, open the connected Space → Space settings → Task statuses, then add the missing statuses. OXUS cannot create custom statuses through the ClickUp API.";
