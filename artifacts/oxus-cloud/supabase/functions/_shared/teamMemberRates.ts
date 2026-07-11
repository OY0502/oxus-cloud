/** Shared rate resolution for edge functions — mirrors src/lib/teamMemberRates.ts */

export type RateType = "hourly" | "daily" | "monthly" | "fixed_project";
export type RateStatus = "active" | "scheduled" | "expired";
export type RateMatchType = "project_work_type" | "project" | "work_type" | "default" | "none";

export interface TeamMemberRateRow {
  id: string;
  person_id: string;
  name: string | null;
  description: string | null;
  rate_type: RateType;
  amount: number;
  currency: string;
  project_id: string | null;
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
