import type { Availability, Contact, CompanyPerson, ProjectWithAssignees, RateType, TeamMemberRate } from "@/lib/types";
import { formatCurrency } from "@/lib/currency";
import { getDefaultRate } from "@/lib/teamMemberRates";

/** Team-specific fields stored in contacts.metadata */
export interface TeamMemberMetadata {
  start_date?: string | null;
  end_date?: string | null;
  weekly_available_hours?: number | null;
  capacity_percent?: number | null;
  available_from?: string | null;
  availability_notes?: string | null;
  default_currency?: string | null;
  payment_terms?: string | null;
  internal_notes?: string | null;
}

export function parseTeamMetadata(contact: Contact): TeamMemberMetadata {
  const raw = contact.metadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as TeamMemberMetadata;
}

export function mergeTeamMetadata(
  contact: Contact,
  patch: Partial<TeamMemberMetadata>,
): Record<string, unknown> {
  return { ...parseTeamMetadata(contact), ...patch };
}

export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const AVAILABILITY_LABELS: Record<string, string> = {
  full: "Available",
  partial: "Partial",
  busy: "Fully allocated",
  unavailable: "Unavailable",
};

export function availabilityLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return AVAILABILITY_LABELS[value] ?? value;
}

export function availabilityVariant(
  value: string | null | undefined,
): "success" | "warning" | "danger" | "neutral" {
  if (value === "full") return "success";
  if (value === "partial") return "warning";
  if (value === "busy") return "danger";
  if (value === "unavailable") return "danger";
  return "neutral";
}

export function personStatusVariant(
  status: string | null | undefined,
): "success" | "neutral" | "danger" {
  if (status === "active") return "success";
  if (status === "inactive") return "danger";
  return "neutral";
}

/** company_people relationship types that mark someone as on the Team roster */
export function isTeamRelationship(relationshipType: string): boolean {
  return (
    relationshipType === "team_member" ||
    relationshipType === "employee" ||
    relationshipType === "contractor"
  );
}

/** Display label for contacts.type — maps legacy "contractor" to Team Member */
export function contactTypeLabel(type: string | null | undefined): string {
  if (type === "contractor") return "Team Member";
  if (!type) return "—";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function isPersonInactive(contact: Contact): boolean {
  return contact.person_status === "inactive";
}

export function deactivatedAtLabel(contact: Contact): string | null {
  if (!isPersonInactive(contact)) return null;
  const at = contact.deactivated_at;
  if (!at) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(at));
  } catch {
    return at.slice(0, 10);
  }
}

export function rosterAvailabilityLabel(contact: Contact): string {
  if (isPersonInactive(contact)) return "Inactive";
  return availabilityLabel(contact.availability);
}

export function rosterAvailabilityVariant(
  contact: Contact,
): "success" | "warning" | "danger" | "neutral" {
  if (isPersonInactive(contact)) return "neutral";
  return availabilityVariant(contact.availability);
}

export function isTeamPerson(
  contactId: string,
  contacts: Contact[],
  companyPeople: CompanyPerson[],
): boolean {
  for (const rel of companyPeople) {
    if (rel.person_id === contactId && isTeamRelationship(rel.relationship_type)) {
      return true;
    }
  }
  const c = contacts.find((x) => x.id === contactId);
  return c?.type === "contractor" || c?.type === "agent";
}

export function currentRate(
  rates: TeamMemberRate[],
  asOf = new Date().toISOString().slice(0, 10),
): TeamMemberRate | null {
  return getDefaultRate(rates, asOf) ?? (
    rates.find((r) => r.effective_from <= asOf && (!r.effective_to || r.effective_to >= asOf)) ??
    rates[0] ??
    null
  );
}

const RATE_SUFFIX: Record<RateType, string> = {
  hourly: "/hr",
  daily: "/day",
  monthly: "/mo",
  fixed_project: " fixed",
};

export function formatRate(rate: TeamMemberRate | null | undefined): string {
  if (!rate) return "—";
  return `${formatCurrency(rate.amount, rate.currency)}${RATE_SUFFIX[rate.rate_type] ?? ""}`;
}

export function activeProjectsForPerson(
  personId: string,
  projects: ProjectWithAssignees[],
): ProjectWithAssignees[] {
  return projects.filter(
    (p) =>
      !p.archived_at &&
      !p.is_draft &&
      (p.status === "in-progress" || p.status === "planning") &&
      (p.team_contacts ?? []).some((c: Contact) => c.id === personId),
  );
}

export function projectNamesCell(projects: { name: string }[], max = 2): string {
  if (projects.length === 0) return "—";
  const names = projects.slice(0, max).map((p) => p.name);
  const extra = projects.length - max;
  return extra > 0 ? `${names.join(", ")} +${extra}` : names.join(", ");
}

export type StatusFilter = "active" | "inactive";
export type AvailabilityFilter = "all" | Availability;

export function paidYtdRank(
  personId: string,
  roster: { person: { id: string }; paid_ytd: number }[],
): { rank: number; total: number; paidYtd: number } | null {
  if (roster.length === 0) return null;
  const row = roster.find((r) => r.person.id === personId);
  if (!row) return null;
  const rank = roster.filter((r) => r.paid_ytd > row.paid_ytd).length + 1;
  return { rank, total: roster.length, paidYtd: row.paid_ytd };
}

export function filterTeamRoster(
  contacts: Contact[],
  teamPersonIds: Set<string>,
  statusFilter: StatusFilter,
  availability: AvailabilityFilter,
  projectId: string | null,
  search: string,
  projects: ProjectWithAssignees[],
): Contact[] {
  const q = search.trim().toLowerCase();
  const matchesSearch = (c: Contact) =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    (c.email?.toLowerCase().includes(q) ?? false) ||
    (c.job_title?.toLowerCase().includes(q) ?? false);

  return contacts
    .filter((c) => teamPersonIds.has(c.id))
    .filter((c) => {
      if (statusFilter === "inactive") return c.person_status === "inactive";
      if (c.person_status === "inactive") {
        return q.length > 0 && matchesSearch(c);
      }
      return true;
    })
    .filter((c) => {
      if (availability === "all") return true;
      if (c.person_status === "inactive") {
        return statusFilter === "inactive" || (q.length > 0 && matchesSearch(c));
      }
      return c.availability === availability;
    })
    .filter((c) => {
      if (!projectId) return true;
      const p = projects.find((x) => x.id === projectId);
      return (p?.team_contacts ?? []).some((tc: Contact) => tc.id === c.id);
    })
    .filter(matchesSearch);
}
