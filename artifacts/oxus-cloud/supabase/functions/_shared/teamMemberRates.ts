/** Shared rate resolution for edge functions — mirrors src/lib/teamMemberRates.ts */

export type RateType = "hourly" | "daily" | "monthly" | "fixed_project";
export type RateStatus = "active" | "scheduled" | "expired";
export type RateMatchType = "project_work_type" | "project" | "work_type" | "default" | "none";

export interface TeamMemberRateProjectRow {
  id: string;
  name: string;
  archived_at?: string | null;
}

export interface TeamMemberRateRow {
  id: string;
  person_id: string;
  name: string | null;
  description: string | null;
  rate_type: RateType;
  amount: number;
  currency: string;
  project_id: string | null;
  project_ids?: string[];
  projects?: TeamMemberRateProjectRow[];
  work_type: string | null;
  is_default: boolean;
  effective_from: string;
  effective_to: string | null;
  status: RateStatus;
  notes: string | null;
  created_at: string;
}

const WORK_TYPE_ALIASES: Record<string, string> = {
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

export function normalizeWorkType(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return WORK_TYPE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function rateProjectIds(rate: Pick<TeamMemberRateRow, "project_ids" | "project_id">): string[] {
  if (rate.project_ids?.length) return rate.project_ids;
  if (rate.project_id) return [rate.project_id];
  return [];
}

export function isRateActiveOnDate(rate: TeamMemberRateRow, asOf: string): boolean {
  return (
    rate.effective_from <= asOf &&
    (!rate.effective_to || rate.effective_to >= asOf) &&
    rate.status !== "expired"
  );
}

function matchesScope(
  rate: TeamMemberRateRow,
  projectId: string | null,
  workType: string | null,
  matchType: RateMatchType,
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

export function enrichTeamMemberRates(
  rates: TeamMemberRateRow[],
  links: Array<{ rate_id: string; project_id: string; projects: TeamMemberRateProjectRow | null }>,
): TeamMemberRateRow[] {
  const byRate = new Map<string, TeamMemberRateProjectRow[]>();
  for (const link of links) {
    if (!link.projects) continue;
    const list = byRate.get(link.rate_id) ?? [];
    list.push(link.projects);
    byRate.set(link.rate_id, list);
  }

  return rates.map((rate) => {
    const projects = byRate.get(rate.id) ?? [];
    const project_ids = projects.length
      ? projects.map((p) => p.id)
      : rate.project_id
        ? [rate.project_id]
        : [];
    return {
      ...rate,
      projects,
      project_ids,
    };
  });
}

export function resolveTeamMemberRate(input: {
  rates: TeamMemberRateRow[];
  projectId?: string | null;
  workType?: string | null;
  effectiveDate?: string;
}): {
  rate: TeamMemberRateRow | null;
  match_type: RateMatchType;
  alternatives: TeamMemberRateRow[];
  warning?: string;
} {
  const asOf = input.effectiveDate ?? new Date().toISOString().slice(0, 10);
  const projectId = input.projectId ?? null;
  const workType = normalizeWorkType(input.workType);
  const activeRates = input.rates.filter((r) => isRateActiveOnDate(r, asOf));

  const precedence: RateMatchType[] = [
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

export const SUPPORTED_CURRENCIES = ["EUR", "USD"] as const;

export function validateCurrency(currency: string): string {
  const upper = currency.toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(upper as typeof SUPPORTED_CURRENCIES[number])) {
    throw new Error(`Unsupported currency: ${currency}. Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }
  return upper;
}

export function parseRateConflictError(message: string): { conflicts: unknown[] } | null {
  const prefix = "RATE_CONFLICT:";
  const idx = message.indexOf(prefix);
  if (idx === -1) return null;
  try {
    const payload = JSON.parse(message.slice(idx + prefix.length));
    return payload as { conflicts: unknown[] };
  } catch {
    return null;
  }
}
