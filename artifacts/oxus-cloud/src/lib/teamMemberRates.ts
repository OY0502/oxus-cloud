import type { RateType, TeamMemberRate, TeamMemberRateMatchType } from "@/lib/types";

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

export function rateScope(rate: TeamMemberRate): RateScope {
  const hasProject = !!rate.project_id;
  const hasWorkType = !!rate.work_type?.trim();
  if (hasProject && hasWorkType) return "project_work_type";
  if (hasProject) return "project";
  if (hasWorkType) return "work_type";
  return "default";
}

export function rateScopeLabel(rate: TeamMemberRate, projectName?: string | null): string {
  const scope = rateScope(rate);
  switch (scope) {
    case "project_work_type":
      return `${projectName ?? "Project"} · ${rate.work_type}`;
    case "project":
      return projectName ?? "Project-specific";
    case "work_type":
      return rate.work_type ?? "Work type";
    default:
      return "Default";
  }
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
  switch (matchType) {
    case "project_work_type":
      return rate.project_id === projectId && normalizeWorkType(rate.work_type) === workType;
    case "project":
      return rate.project_id === projectId && !rate.work_type?.trim();
    case "work_type":
      return !rate.project_id && normalizeWorkType(rate.work_type) === workType;
    case "default":
      return !rate.project_id && !rate.work_type?.trim();
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
  return `${symbol}${amount} / ${suffix}`;
}

export function formatRateDescription(
  rate: TeamMemberRate,
  options?: { projectName?: string | null; effectiveDate?: string },
): string {
  const preview = formatRatePreview(rate);
  const scope = rateScopeLabel(rate, options?.projectName);
  const parts = [preview];
  if (scope !== "Default") parts.push(`for ${scope}`);
  if (options?.effectiveDate) {
    parts.push(`effective from ${options.effectiveDate}`);
  } else if (rate.effective_from) {
    parts.push(`effective from ${rate.effective_from}`);
  }
  return parts.join(" · ");
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
  projectId: string,
  workType: string,
): { project_id: string | null; work_type: string | null; is_default: boolean } {
  switch (appliesTo) {
    case "project":
      return { project_id: projectId || null, work_type: null, is_default: false };
    case "work_type":
      return { project_id: null, work_type: normalizeWorkType(workType), is_default: false };
    case "project_work_type":
      return {
        project_id: projectId || null,
        work_type: normalizeWorkType(workType),
        is_default: false,
      };
    default:
      return { project_id: null, work_type: null, is_default: true };
  }
}

export { normalizeWorkType, scopeSpecificity };
