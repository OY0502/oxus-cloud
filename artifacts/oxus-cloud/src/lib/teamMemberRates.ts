import type { RateType, TeamMemberRate, TeamMemberRateMatchType, TeamMemberRateProject } from "@/lib/types";

export const WORK_TYPES = [
  "Development",
  "UI/UX Design",
  "Project Management",
  "Technical Consulting",
  "QA",
  "Support",
  "Workshop",
  "Other",
] as const;

export type WorkType = (typeof WORK_TYPES)[number];

export const SUPPORTED_CURRENCIES = ["EUR", "USD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export type RateScope = "default" | "project" | "work_type" | "project_work_type";

export interface ResolveTeamMemberRateInput {
  rates: TeamMemberRate[];
  projectId?: string | null;
  workType?: string | null;
  effectiveDate?: string;
}

export interface ResolveTeamMemberRateResult {
  rate: TeamMemberRate | null;
  match_type: TeamMemberRateMatchType;
  alternatives: TeamMemberRate[];
  warning?: string;
}

function normalizeWorkType(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const aliases: Record<string, WorkType> = {
    dev: "Development",
    developer: "Development",
    "developer work": "Development",
    development: "Development",
    "ui/ux": "UI/UX Design",
    "ui/ux design": "UI/UX Design",
    design: "UI/UX Design",
    pm: "Project Management",
    "project management": "Project Management",
    consulting: "Technical Consulting",
    "technical consulting": "Technical Consulting",
    "tech consulting": "Technical Consulting",
    qa: "QA",
    testing: "QA",
    support: "Support",
    workshop: "Workshop",
    other: "Other",
  };
  return aliases[lower] ?? trimmed;
}

/** Resolved project IDs for a rate (join table with legacy fallback). */
export function rateProjectIds(rate: Pick<TeamMemberRate, "project_ids" | "project_id">): string[] {
  if (rate.project_ids?.length) return rate.project_ids;
  if (rate.project_id) return [rate.project_id];
  return [];
}

/** Resolved project records for a rate. */
export function rateProjects(rate: TeamMemberRate): TeamMemberRateProject[] {
  if (rate.projects?.length) return rate.projects;
  return [];
}

export function rateHasProjects(rate: Pick<TeamMemberRate, "project_ids" | "project_id">): boolean {
  return rateProjectIds(rate).length > 0;
}

export function rateScope(rate: TeamMemberRate): RateScope {
  const hasProject = rateHasProjects(rate);
  const hasWorkType = !!rate.work_type?.trim();
  if (hasProject && hasWorkType) return "project_work_type";
  if (hasProject) return "project";
  if (hasWorkType) return "work_type";
  return "default";
}

export function formatProjectNames(
  projects: TeamMemberRateProject[],
  options?: { maxVisible?: number },
): { display: string; full: string } {
  const maxVisible = options?.maxVisible ?? 2;
  const names = projects.map((p) => p.name);
  const full = names.join(", ");
  if (names.length <= maxVisible) {
    return { display: full, full };
  }
  const visible = names.slice(0, maxVisible).join(", ");
  const remaining = names.length - maxVisible;
  return { display: `${visible} +${remaining}`, full };
}

export function rateScopeLabel(rate: TeamMemberRate): string {
  const scope = rateScope(rate);
  const projects = rateProjects(rate);
  const { display: projectLabel } = formatProjectNames(projects);

  switch (scope) {
    case "project_work_type":
      return projects.length ? `${rate.work_type} · ${projectLabel}` : (rate.work_type ?? "Work type");
    case "project":
      return projectLabel || "Project-specific";
    case "work_type":
      return rate.work_type ?? "Work type";
    default:
      return "Default";
  }
}

export function rateAppliesToLabel(rate: TeamMemberRate): string {
  const scope = rateScope(rate);
  const projects = rateProjects(rate);
  const { display } = formatProjectNames(projects);

  if (scope === "project_work_type") {
    return [rate.work_type, display].filter(Boolean).join("\n");
  }
  if (scope === "project") return display || "—";
  if (scope === "work_type") return rate.work_type ?? "—";
  return "Default";
}

export function isRateActiveOnDate(
  rate: TeamMemberRate,
  asOf: string,
): boolean {
  return (
    rate.effective_from <= asOf &&
    (!rate.effective_to || rate.effective_to >= asOf) &&
    rate.status !== "expired"
  );
}

function scopeSpecificity(matchType: TeamMemberRateMatchType): number {
  switch (matchType) {
    case "project_work_type":
      return 4;
    case "project":
      return 3;
    case "work_type":
      return 2;
    case "default":
      return 1;
    default:
      return 0;
  }
}

function matchesScope(
  rate: TeamMemberRate,
  projectId: string | null | undefined,
  workType: string | null,
  matchType: TeamMemberRateMatchType,
): boolean {
  const linkedProjects = rateProjectIds(rate);
  const hasProjects = linkedProjects.length > 0;
  const hasWorkType = !!rate.work_type?.trim();

  switch (matchType) {
    case "project_work_type":
      return (
        !!projectId &&
        linkedProjects.includes(projectId) &&
        normalizeWorkType(rate.work_type) === workType
      );
    case "project":
      return !!projectId && linkedProjects.includes(projectId) && !hasWorkType;
    case "work_type":
      return !hasProjects && normalizeWorkType(rate.work_type) === workType;
    case "default":
      return !hasProjects && !hasWorkType;
    default:
      return false;
  }
}

/**
 * Shared rate resolution — same precedence everywhere (UI, server, edge functions).
 * 1. Exact project + work type
 * 2. Exact project, no work type
 * 3. Exact work type, no project
 * 4. Default rate
 * 5. No rate found
 */
export function resolveTeamMemberRate(
  input: ResolveTeamMemberRateInput,
): ResolveTeamMemberRateResult {
  const asOf = input.effectiveDate ?? new Date().toISOString().slice(0, 10);
  const projectId = input.projectId ?? null;
  const workType = normalizeWorkType(input.workType);

  const activeRates = input.rates.filter((r) => isRateActiveOnDate(r, asOf));

  const precedence: TeamMemberRateMatchType[] = [
    "project_work_type",
    "project",
    "work_type",
    "default",
  ];

  for (const matchType of precedence) {
    if (matchType === "project_work_type" && (!projectId || !workType)) continue;
    if (matchType === "project" && !projectId) continue;
    if (matchType === "work_type" && !workType) continue;

    const candidates = activeRates.filter((r) =>
      matchesScope(r, projectId, workType, matchType),
    );

    if (candidates.length === 1) {
      return { rate: candidates[0], match_type: matchType, alternatives: [] };
    }

    if (candidates.length > 1) {
      return {
        rate: null,
        match_type: matchType,
        alternatives: candidates,
        warning: `Multiple ${matchType.replace(/_/g, " ")} rates match for ${asOf}. Select one explicitly.`,
      };
    }
  }

  return { rate: null, match_type: "none", alternatives: [] };
}

export function getDefaultRate(
  rates: TeamMemberRate[],
  asOf?: string,
): TeamMemberRate | null {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const active = rates.filter((r) => isRateActiveOnDate(r, date));
  return (
    active.find((r) => r.is_default && rateScope(r) === "default") ??
    active.find((r) => rateScope(r) === "default") ??
    null
  );
}

const RATE_SUFFIX: Record<RateType, string> = {
  hourly: "hour",
  daily: "day",
  monthly: "month",
  fixed_project: "fixed",
};

export function formatRatePreview(
  rate: Partial<Pick<TeamMemberRate, "amount" | "currency" | "rate_type">>,
): string {
  const symbol = rate.currency === "USD" ? "$" : "€";
  const suffix = rate.rate_type ? RATE_SUFFIX[rate.rate_type] : "hour";
  const amount = rate.amount != null ? Number(rate.amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "—";
  if (rate.rate_type === "fixed_project") {
    return `${symbol}${amount} fixed`;
  }
  return `${symbol}${amount} per ${suffix}`;
}

export function formatProjectScopePreview(
  projects: TeamMemberRateProject[],
): string {
  if (projects.length === 0) return "";
  if (projects.length === 1) return projects[0]!.name;
  if (projects.length === 2) return `${projects[0]!.name} and ${projects[1]!.name}`;
  return `${projects.length} selected projects`;
}

export function formatRateDescription(
  rate: TeamMemberRate,
  options?: { effectiveDate?: string },
): string {
  const preview = formatRatePreview(rate);
  const scope = rateScope(rate);
  const projects = rateProjects(rate);
  const parts = [preview];

  if (scope === "project_work_type") {
    const projectText = formatProjectScopePreview(projects);
    parts.push(`for ${rate.work_type} on ${projectText}`);
  } else if (scope === "project") {
    parts.push(`for ${formatProjectScopePreview(projects)}`);
  } else if (scope === "work_type") {
    parts.push(`for ${rate.work_type}`);
  }

  const effectiveDate = options?.effectiveDate ?? rate.effective_from;
  if (effectiveDate) parts.push(`Effective from ${effectiveDate}`);

  return parts.join("\n");
}

export function rateStatusVariant(
  status: TeamMemberRate["status"],
): "success" | "warning" | "neutral" | "danger" {
  switch (status) {
    case "active":
      return "success";
    case "scheduled":
      return "warning";
    case "expired":
      return "neutral";
    default:
      return "neutral";
  }
}

export function computeRateStatus(
  effectiveFrom: string,
  effectiveTo: string | null | undefined,
  asOf = new Date().toISOString().slice(0, 10),
): TeamMemberRate["status"] {
  if (effectiveFrom > asOf) return "scheduled";
  if (effectiveTo && effectiveTo < asOf) return "expired";
  return "active";
}

export function scopeFromForm(
  appliesTo: "default" | "project" | "work_type" | "project_work_type",
  projectIds: string[],
  workType: string,
): { project_ids: string[]; work_type: string | null; is_default: boolean } {
  switch (appliesTo) {
    case "project":
      return { project_ids: projectIds, work_type: null, is_default: false };
    case "work_type":
      return { project_ids: [], work_type: normalizeWorkType(workType), is_default: false };
    case "project_work_type":
      return {
        project_ids: projectIds,
        work_type: normalizeWorkType(workType),
        is_default: false,
      };
    default:
      return { project_ids: [], work_type: null, is_default: true };
  }
}

export function mapTeamMemberRateRow(row: Record<string, unknown>): TeamMemberRate {
  const links = (row.team_member_rate_projects ?? []) as Array<{
    project_id: string;
    projects: { id: string; name: string; archived_at?: string | null } | null;
  }>;

  const projects: TeamMemberRateProject[] = links
    .map((link) => link.projects)
    .filter((p): p is TeamMemberRateProject => !!p)
    .map((p) => ({ id: p.id, name: p.name, archived_at: p.archived_at ?? null }));

  const project_ids = projects.length
    ? projects.map((p) => p.id)
    : row.project_id
      ? [String(row.project_id)]
      : [];

  const rate = row as unknown as TeamMemberRate;
  return {
    ...rate,
    project_ids,
    projects,
    project_id: project_ids[0] ?? null,
    status: rate.status ?? computeRateStatus(rate.effective_from, rate.effective_to),
  };
}

export { normalizeWorkType, scopeSpecificity };
