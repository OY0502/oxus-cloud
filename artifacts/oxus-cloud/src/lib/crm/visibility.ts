export function aggregateSourceLabels(sources: string[]): string {
  const normalized = [...new Set(sources.map((s) => s.trim()).filter(Boolean))];
  if (normalized.length === 0) return "Manual";
  if (normalized.length === 1) return normalized[0];
  return `${normalized[0]} + ${normalized.length - 1}`;
}

export function parseEntitySources(
  source?: string | null,
  aggregated?: string[] | null,
): string[] {
  if (aggregated?.length) return aggregated;
  const labels = new Set<string>();
  const raw = (source ?? "").toLowerCase();
  if (!raw || raw === "manual") labels.add("Manual");
  if (raw.includes("google contact")) labels.add("Google Contacts");
  if (raw.includes("gmail") || raw.includes("google")) labels.add("Gmail");
  if (raw.includes("calendar")) labels.add("Google Calendar");
  if (raw.includes("project")) labels.add("Project");
  if (raw.includes("proposal") || raw.includes("quote")) labels.add("Proposal");
  if (raw.includes("stripe")) labels.add("Stripe");
  if (raw.includes("firecrawl")) labels.add("Firecrawl");
  if (raw.includes(" + ")) {
    const [primary, rest] = source!.split(" + ");
    labels.add(primary);
    const extra = Number(rest);
    if (!Number.isNaN(extra)) {
      for (let i = 0; i < extra; i++) labels.add("Multiple sources");
    }
  }
  return labels.size ? [...labels] : ["Manual"];
}

export type VisibilityState = "active" | "needs_review" | "suppressed" | "inactive" | "merged";

export function isListableInCrm(args: {
  visibility_state?: string | null;
  data_quality_status?: string | null;
  is_role_inbox?: boolean;
  soft_deleted_at?: string | null;
}): boolean {
  if (args.soft_deleted_at) return false;
  const visibility = args.visibility_state ?? (
    args.data_quality_status === "suppressed" || args.data_quality_status === "ignored"
      ? "suppressed"
      : args.data_quality_status === "needs_review"
        ? "needs_review"
        : "active"
  );
  if (visibility === "suppressed" || visibility === "merged") return false;
  return true;
}

export function isActiveInDefaultCrmView(args: {
  visibility_state?: string | null;
  data_quality_status?: string | null;
  is_role_inbox?: boolean;
  soft_deleted_at?: string | null;
}): boolean {
  if (!isListableInCrm(args)) return false;
  const visibility = args.visibility_state ?? (
    args.data_quality_status === "suppressed" || args.data_quality_status === "ignored"
      ? "suppressed"
      : args.data_quality_status === "needs_review"
        ? "needs_review"
        : "active"
  );
  if (visibility === "inactive") return false;
  if (visibility === "needs_review") return false;
  if (args.is_role_inbox) return false;
  return true;
}

export function personQualityBadge(args: {
  data_quality_status?: string | null;
  is_role_inbox?: boolean;
  name_confidence?: number | null;
  manually_confirmed?: boolean;
  source?: string | null;
}): string | null {
  if (args.manually_confirmed) return "Manual";
  if (args.is_role_inbox) return "Role inbox";
  if (args.data_quality_status === "needs_review") return "Needs review";
  if ((args.name_confidence ?? 1) < 0.55) return "Low confidence";
  if ((args.source ?? "").toLowerCase().includes("google")) return "Imported";
  return null;
}
