import type { Contact } from "@/lib/types";
import { resolvePersonName } from "./personNaming";
import { parseEntitySources } from "./visibility";

export type PersonDisplayState = {
  title: string;
  subtitle: string | null;
  emailLine: string | null;
  warning: string | null;
  qualityBadge: string | null;
  sourceSummary: string;
};

export function getPersonDisplayState(person: Contact): PersonDisplayState {
  const email = person.primary_email ?? person.email ?? null;
  const resolved = resolvePersonName({
    email: email ?? "",
    displayName: person.display_name ?? person.name,
    manuallyConfirmed: person.manually_confirmed,
    confirmedName: person.manually_confirmed ? (person.display_name ?? person.name) : null,
  });

  const isUnknown = !person.manually_confirmed && (
    !person.display_name?.trim()
    || person.display_name === "Unknown contact"
    || person.name === "Unknown contact"
    || (person.name_confidence ?? 1) < 0.55
  );

  const title = person.manually_confirmed
    ? (person.display_name ?? person.name ?? "Unknown contact")
    : isUnknown
      ? "Unknown contact"
      : (person.display_name ?? person.name ?? resolved.displayName);

  let subtitle: string | null = null;
  if (person.job_title && person.company) {
    subtitle = `${person.job_title} at ${person.company}`;
  } else if (person.job_title) {
    subtitle = person.job_title;
  } else if (person.relationship_type) {
    subtitle = formatRelationshipLabel(person.relationship_type);
  }

  let warning: string | null = null;
  if (isUnknown && email) warning = "Name needs confirmation";
  else if (person.data_quality_status === "needs_review") warning = "Needs review";

  const sources = parseEntitySources(person.source, person.aggregated_sources);
  const qualityBadge = person.manually_confirmed
    ? null
    : person.data_quality_status === "needs_review" || isUnknown
      ? "Needs review"
      : null;

  return {
    title,
    subtitle,
    emailLine: email,
    warning,
    qualityBadge,
    sourceSummary: sources.join(" · "),
  };
}

export function formatRelationshipLabel(value?: string | null): string {
  if (!value) return "Contact";
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatLifecycleLabel(value?: string | null): string {
  if (!value) return "—";
  return formatRelationshipLabel(value);
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.55) return "Medium";
  return "Low";
}

export const PERSON_EDITABLE_FIELDS = [
  "first_name", "last_name", "display_name", "email", "alternate_emails", "phone",
  "job_title", "client_id", "relationship_type", "lifecycle_stage", "relationship_owner_id",
  "location", "timezone", "language", "notes", "tags", "primary_project_id", "type",
] as const;

export type PersonEditableField = (typeof PERSON_EDITABLE_FIELDS)[number];
