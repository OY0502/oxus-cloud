import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { canOverwriteField, type FieldProvenance } from "./crmEntityResolution.ts";
import {
  deleteCrmPerson,
  mergeCrmPeople,
} from "./crmOperations.ts";
import { normalizeEmail } from "./google-auth.ts";

export type CrmPersonRole = "super_admin" | "pm" | string | null;

const PM_EDITABLE_FIELDS = new Set([
  "first_name", "last_name", "display_name", "name", "email", "primary_email",
  "alternate_emails", "phone", "job_title", "client_id", "company",
  "relationship_type", "type", "relationship_owner_id", "location", "timezone",
  "language", "notes", "tags", "primary_project_id", "lifecycle_stage",
  "linkedin_url", "decision_maker", "technical_contact", "billing_contact",
]);

const ADMIN_ONLY_FIELDS = new Set([
  "visibility_state", "data_quality_status", "person_status", "manually_confirmed",
  "locked_fields", "field_provenance", "suppressed_at", "archived_at",
  "soft_deleted_at", "merged_into_id",
]);

export function isCrmAdmin(role: CrmPersonRole): boolean {
  return role === "super_admin";
}

export function isCrmEditor(role: CrmPersonRole): boolean {
  return role === "super_admin" || role === "pm";
}

function splitName(displayName: string): { firstName: string | null; lastName: string | null } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function parseEmailLocalPart(email: string): string | null {
  const local = email.split("@")[0] ?? "";
  if (!local) return null;
  const segments = local.split(/[._-]+/).filter(Boolean);
  if (segments.length === 0) return null;
  const candidate = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(" ");
  return candidate.length >= 2 && !candidate.includes("@") ? candidate : null;
}

export function buildNameSuggestion(person: {
  email?: string | null;
  primary_email?: string | null;
  display_name?: string | null;
  name?: string | null;
  manually_confirmed?: boolean;
  name_confidence?: number | null;
}): { suggested_name: string; confidence: number; source: string } | null {
  if (person.manually_confirmed) return null;
  const display = person.display_name ?? person.name ?? "";
  if (display && display !== "Unknown contact" && !display.includes("@") && (person.name_confidence ?? 0) >= 0.55) {
    return null;
  }
  const email = person.primary_email ?? person.email;
  if (!email) return null;
  const suggested = parseEmailLocalPart(email);
  if (!suggested) return null;
  return { suggested_name: suggested, confidence: 0.45, source: "email_local_part" };
}

export function personNeedsReview(person: {
  manually_confirmed?: boolean;
  name_confidence?: number | null;
  display_name?: string | null;
  name?: string | null;
  data_quality_status?: string | null;
  visibility_state?: string | null;
}): boolean {
  if (person.manually_confirmed) return false;
  if (person.data_quality_status === "needs_review") return true;
  if (person.visibility_state === "needs_review") return true;
  const display = person.display_name ?? person.name ?? "";
  if (!display || display === "Unknown contact" || display.includes("@")) return true;
  return (person.name_confidence ?? 1) < 0.55;
}

async function logPersonActivity(
  admin: SupabaseClient,
  input: {
    contactId: string;
    title: string;
    description?: string | null;
    kind?: string;
    companyId?: string | null;
    interactionType?: string;
    source?: string;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await admin.from("activities").insert({
    contact_id: input.contactId,
    company_id: input.companyId ?? null,
    title: input.title,
    description: input.description ?? null,
    kind: input.kind ?? "info",
    interaction_type: input.interactionType ?? null,
    source: input.source ?? "manual",
    occurred_at: new Date().toISOString(),
    entity_type: "contact",
    entity_id: input.contactId,
    created_by: input.createdBy ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function getPersonDetail(
  admin: SupabaseClient,
  personId: string,
): Promise<Record<string, unknown>> {
  const { data: person, error } = await admin.from("contacts").select("*").eq("id", personId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw new Error("Person not found.");

  const [
    { data: companyPeople },
    { data: owner },
    { data: primaryCompany },
    { data: recentActivities },
    { data: googleInteractions },
    { data: projects },
    { data: quotes },
    { data: entitySources },
    { data: identities },
  ] = await Promise.all([
    admin.from("company_people").select("*, clients(*)").eq("person_id", personId).order("is_primary", { ascending: false }),
    person.relationship_owner_id
      ? admin.from("profiles").select("id, full_name, email, avatar_url").eq("id", person.relationship_owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    person.client_id
      ? admin.from("clients").select("*").eq("id", person.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("activities")
      .select("*")
      .eq("contact_id", personId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5),
    admin.from("google_interactions")
      .select("id, interaction_type, subject, occurred_at, ai_summary, snippet, source, company_id")
      .contains("person_ids", [personId])
      .order("occurred_at", { ascending: false })
      .limit(5),
    admin.from("projects")
      .select("id, name, status, archived_at, point_of_contact_id, organization_id, client_id")
      .eq("point_of_contact_id", personId),
    admin.from("quotes")
      .select("id, title, stage, budget, organization_id, point_of_contact_id")
      .eq("point_of_contact_id", personId)
      .not("stage", "in", '("won","lost","archived")'),
    admin.from("crm_entity_sources").select("*").eq("entity_type", "person").eq("entity_id", personId),
    admin.from("person_identities").select("*").eq("person_id", personId),
  ]);

  const activeProjects = (projects ?? []).filter(
    (p) => !p.archived_at && (p.status === "in-progress" || p.status === "planning" || p.status === "on-hold"),
  );

  const lastInteractionAt = person.last_interaction_at ?? person.last_contact_at ?? null;
  const now = Date.now();
  const safeLastInteraction = lastInteractionAt && new Date(lastInteractionAt).getTime() <= now
    ? lastInteractionAt
    : null;

  const companies = (companyPeople ?? []).map((cp) => ({
    ...cp,
    company: cp.clients ?? null,
  }));

  return {
    person,
    primary_company: primaryCompany,
    companies,
    owner,
    projects: projects ?? [],
    opportunities: quotes ?? [],
    summary: {
      last_interaction_at: safeLastInteraction,
      next_meeting_at: person.next_meeting_at ?? null,
      meeting_count: person.meeting_count ?? 0,
      active_projects: activeProjects.length,
      open_opportunities: (quotes ?? []).length,
      interaction_count: person.interaction_count ?? 0,
      email_thread_count: person.email_thread_count ?? 0,
    },
    name_suggestion: buildNameSuggestion(person),
    needs_review: personNeedsReview(person),
    recent_activities: recentActivities ?? [],
    recent_google_interactions: googleInteractions ?? [],
    sources: entitySources ?? [],
    identities: identities ?? [],
    association_counts: {
      companies: companies.length,
      projects: (projects ?? []).length,
      opportunities: (quotes ?? []).length,
    },
  };
}

export type ActivityFilter = "all" | "emails" | "meetings" | "notes" | "tasks" | "business";

export async function getPersonActivities(
  admin: SupabaseClient,
  personId: string,
  options: { limit?: number; offset?: number; filter?: ActivityFilter } = {},
): Promise<{ items: Record<string, unknown>[]; total: number; has_more: boolean }> {
  const limit = Math.min(options.limit ?? 20, 50);
  const offset = options.offset ?? 0;
  const filter = options.filter ?? "all";

  const { data: activities } = await admin.from("activities")
    .select("*")
    .eq("contact_id", personId)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: googleRows } = await admin.from("google_interactions")
    .select("id, interaction_type, subject, occurred_at, ai_summary, snippet, source, company_id, direction, participants")
    .contains("person_ids", [personId])
    .order("occurred_at", { ascending: false })
    .limit(200);

  const normalized: Record<string, unknown>[] = [];

  for (const a of activities ?? []) {
    const interactionType = a.interaction_type ?? a.metadata?.interaction_type ?? null;
    const category = categorizeActivity(interactionType, a.title, a.source);
    if (!matchesFilter(filter, category)) continue;
    normalized.push({
      id: `activity:${a.id}`,
      type: category,
      title: a.title,
      description: a.description,
      occurred_at: a.occurred_at ?? a.created_at,
      source: a.source ?? "manual",
      company_id: a.company_id,
      metadata: a.metadata ?? {},
      participants: a.metadata?.participants ?? null,
    });
  }

  for (const g of googleRows ?? []) {
    const category = g.interaction_type === "calendar" || g.interaction_type === "meeting"
      ? "meeting"
      : "email";
    if (!matchesFilter(filter, category)) continue;
    normalized.push({
      id: `google:${g.id}`,
      type: category,
      title: g.subject ?? (category === "meeting" ? "Calendar meeting" : "Email thread"),
      description: g.ai_summary ?? g.snippet ?? null,
      occurred_at: g.occurred_at,
      source: g.source ?? "google",
      company_id: g.company_id,
      metadata: { direction: g.direction },
      participants: g.participants ?? null,
    });
  }

  normalized.sort((a, b) => {
    const aTime = new Date(String(a.occurred_at ?? 0)).getTime();
    const bTime = new Date(String(b.occurred_at ?? 0)).getTime();
    return bTime - aTime;
  });

  const total = normalized.length;
  const items = normalized.slice(offset, offset + limit);
  return { items, total, has_more: offset + limit < total };
}

function categorizeActivity(
  interactionType: string | null,
  title: string,
  source: string | null,
): string {
  const t = (interactionType ?? "").toLowerCase();
  const titleLower = title.toLowerCase();
  if (t.includes("note") || titleLower.includes("note added")) return "note";
  if (t.includes("task")) return "task";
  if (t.includes("meeting") || t.includes("calendar")) return "meeting";
  if (t.includes("email") || t.includes("gmail")) return "email";
  if (t.includes("invoice") || t.includes("proposal") || t.includes("project")) return "business";
  if ((source ?? "").toLowerCase().includes("google")) return "email";
  return "business";
}

function matchesFilter(filter: ActivityFilter, category: string): boolean {
  if (filter === "all") return true;
  if (filter === "emails") return category === "email";
  if (filter === "meetings") return category === "meeting";
  if (filter === "notes") return category === "note";
  if (filter === "tasks") return category === "task";
  if (filter === "business") return category === "business";
  return true;
}

export async function getPersonSources(
  admin: SupabaseClient,
  personId: string,
): Promise<Record<string, unknown>> {
  const { data: person } = await admin.from("contacts").select("*").eq("id", personId).maybeSingle();
  if (!person) throw new Error("Person not found.");

  const [
    { data: entitySources },
    { data: identities },
    { data: mappings },
    { data: googleInteractions },
    { data: calendarAttendees },
  ] = await Promise.all([
    admin.from("crm_entity_sources").select("*").eq("entity_type", "person").eq("entity_id", personId),
    admin.from("person_identities").select("*").eq("person_id", personId),
    admin.from("person_provider_mappings").select("*").eq("person_id", personId),
    admin.from("google_interactions")
      .select("interaction_type, occurred_at, source")
      .contains("person_ids", [personId])
      .order("occurred_at", { ascending: false }),
    admin.from("google_calendar_attendees")
      .select("attendee_email, display_name, event_start_at, created_at")
      .eq("canonical_person_id", personId)
      .order("event_start_at", { ascending: false })
      .limit(20),
  ]);

  const sourceSummaries: Record<string, {
    source_type: string;
    count: number;
    first_observed: string | null;
    last_observed: string | null;
    evidence_summary: string;
    confidence: number | null;
  }> = {};

  for (const row of googleInteractions ?? []) {
    const key = row.interaction_type === "calendar" ? "Google Calendar" : "Gmail";
    const existing = sourceSummaries[key] ?? {
      source_type: key,
      count: 0,
      first_observed: null,
      last_observed: null,
      evidence_summary: "",
      confidence: null,
    };
    existing.count += 1;
    const occurred = row.occurred_at as string;
    if (!existing.first_observed || occurred < existing.first_observed) existing.first_observed = occurred;
    if (!existing.last_observed || occurred > existing.last_observed) existing.last_observed = occurred;
    sourceSummaries[key] = existing;
  }

  if ((mappings ?? []).some((m) => m.provider === "google")) {
    sourceSummaries["Google Contacts"] = {
      source_type: "Google Contacts",
      count: mappings!.filter((m) => m.provider === "google").length,
      first_observed: person.created_at,
      last_observed: person.updated_at,
      evidence_summary: "Linked Google Contact identity",
      confidence: person.identity_confidence ?? null,
    };
  }

  if (person.source && person.source !== "Manual") {
    const label = person.source.includes("Calendar") ? "Google Calendar" : person.source;
    if (!sourceSummaries[label]) {
      sourceSummaries[label] = {
        source_type: label,
        count: person.meeting_count ?? person.interaction_count ?? 1,
        first_observed: person.first_interaction_at ?? person.created_at,
        last_observed: person.last_interaction_at ?? person.updated_at,
        evidence_summary: person.aggregated_sources?.join(", ") ?? label,
        confidence: person.import_confidence ?? person.name_confidence ?? null,
      };
    }
  }

  for (const [key, summary] of Object.entries(sourceSummaries)) {
    if (key === "Gmail") summary.evidence_summary = `${summary.count} interaction${summary.count === 1 ? "" : "s"}`;
    if (key === "Google Calendar") summary.evidence_summary = `${summary.count} meeting${summary.count === 1 ? "" : "s"}`;
  }

  return {
    person_id: personId,
    field_provenance: person.field_provenance ?? {},
    locked_fields: person.locked_fields ?? [],
    sources: Object.values(sourceSummaries),
    entity_sources: entitySources ?? [],
    identities: identities ?? [],
    calendar_attendees: calendarAttendees ?? [],
    mappings: mappings ?? [],
  };
}

export async function updatePersonRecord(
  admin: SupabaseClient,
  personId: string,
  userId: string,
  role: CrmPersonRole,
  fields: Record<string, unknown>,
  options?: { unlock_fields?: string[] },
): Promise<Record<string, unknown>> {
  if (!isCrmEditor(role)) throw new Error("You do not have permission to edit this person.");

  const { data: existing, error } = await admin.from("contacts")
    .select("field_provenance, locked_fields, email, alternate_emails")
    .eq("id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) throw new Error("Person not found.");

  const provenance = { ...(existing.field_provenance ?? {}) } as FieldProvenance;
  let lockedFields = [...(existing.locked_fields ?? [])] as string[];

  if (options?.unlock_fields?.length) {
    if (!isCrmAdmin(role)) throw new Error("Only admins can unlock fields.");
    lockedFields = lockedFields.filter((f) => !options.unlock_fields!.includes(f));
    for (const field of options.unlock_fields) {
      if (provenance[field]) delete provenance[field];
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const changedFields: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (!isCrmAdmin(role) && ADMIN_ONLY_FIELDS.has(key)) continue;
    if (!isCrmAdmin(role) && !PM_EDITABLE_FIELDS.has(key)) continue;
    if (!canOverwriteField(lockedFields, key, provenance, "manual")) continue;

    patch[key] = value;
    provenance[key] = { source: "manual", updated_at: new Date().toISOString() };
    if (!lockedFields.includes(key)) lockedFields.push(key);
    changedFields.push(key);
  }

  if (changedFields.includes("display_name") || changedFields.includes("name")) {
    const displayName = String(patch.display_name ?? patch.name ?? "");
    if (displayName) {
      const { firstName, lastName } = splitName(displayName);
      patch.name = displayName;
      patch.display_name = displayName;
      patch.first_name = firstName;
      patch.last_name = lastName;
      patch.manually_confirmed = true;
      patch.name_confidence = 1;
      patch.name_source = "manual";
      patch.data_quality_status = "accepted";
      patch.visibility_state = "active";
      for (const nameField of ["name", "display_name", "first_name", "last_name"]) {
        if (!lockedFields.includes(nameField)) lockedFields.push(nameField);
        provenance[nameField] = { source: "manual", updated_at: new Date().toISOString() };
      }
    }
  }

  if (changedFields.includes("email") && patch.email) {
    patch.primary_email = patch.email;
  }

  patch.field_provenance = provenance;
  patch.locked_fields = lockedFields;

  const { data, error: updateErr } = await admin.from("contacts")
    .update(patch)
    .eq("id", personId)
    .select("*")
    .single();
  if (updateErr) throw new Error(updateErr.message);

  if (changedFields.length > 0) {
    await logPersonActivity(admin, {
      contactId: personId,
      title: "Contact details updated",
      description: `Updated: ${changedFields.join(", ")}`,
      interactionType: "field_update",
      createdBy: userId,
      metadata: { fields: changedFields },
    });
  }

  return { person: data };
}

export async function acceptPersonNameSuggestion(
  admin: SupabaseClient,
  personId: string,
  userId: string,
  role: CrmPersonRole,
  suggestedName: string,
): Promise<Record<string, unknown>> {
  return updatePersonRecord(admin, personId, userId, role, {
    display_name: suggestedName.trim(),
    name: suggestedName.trim(),
    manually_confirmed: true,
  });
}

export async function createPersonNote(
  admin: SupabaseClient,
  personId: string,
  userId: string,
  role: CrmPersonRole,
  input: { body: string; company_id?: string | null; project_id?: string | null },
): Promise<Record<string, unknown>> {
  if (!isCrmEditor(role)) throw new Error("You do not have permission to add notes.");
  const body = input.body.trim();
  if (!body) throw new Error("Note body is required.");

  const { data, error } = await admin.from("activities").insert({
    contact_id: personId,
    company_id: input.company_id ?? null,
    title: "Note added",
    description: body,
    kind: "info",
    interaction_type: "note",
    source: "manual",
    occurred_at: new Date().toISOString(),
    entity_type: "contact",
    entity_id: personId,
    created_by: userId,
    metadata: { project_id: input.project_id ?? null },
  }).select("*").single();
  if (error) throw new Error(error.message);

  return { activity: data };
}

export async function suppressPersonRecord(
  admin: SupabaseClient,
  personId: string,
  userId: string,
  role: CrmPersonRole,
): Promise<Record<string, unknown>> {
  if (!isCrmAdmin(role)) throw new Error("Only admins can suppress records.");
  const now = new Date().toISOString();
  const { data, error } = await admin.from("contacts").update({
    visibility_state: "suppressed",
    data_quality_status: "suppressed",
    suppressed_at: now,
    updated_at: now,
  }).eq("id", personId).select("*").single();
  if (error) throw new Error(error.message);
  await logPersonActivity(admin, {
    contactId: personId,
    title: "Contact suppressed",
    description: "Removed from default CRM views",
    interactionType: "suppression",
    createdBy: userId,
  });
  return { person: data };
}

export async function restorePersonRecord(
  admin: SupabaseClient,
  personId: string,
  userId: string,
  role: CrmPersonRole,
): Promise<Record<string, unknown>> {
  if (!isCrmAdmin(role)) throw new Error("Only admins can restore records.");
  const { data, error } = await admin.from("contacts").update({
    visibility_state: "active",
    data_quality_status: "accepted",
    suppressed_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", personId).select("*").single();
  if (error) throw new Error(error.message);
  await logPersonActivity(admin, {
    contactId: personId,
    title: "Contact restored",
    description: "Returned to active CRM views",
    interactionType: "restoration",
    createdBy: userId,
    kind: "success",
  });
  return { person: data };
}

export async function setPersonInactive(
  admin: SupabaseClient,
  personId: string,
  userId: string,
  role: CrmPersonRole,
  inactive: boolean,
): Promise<Record<string, unknown>> {
  if (!isCrmEditor(role)) throw new Error("You do not have permission to change status.");
  const patch = inactive
    ? { person_status: "inactive", visibility_state: "inactive", deactivated_at: new Date().toISOString() }
    : { person_status: "active", visibility_state: "active", deactivated_at: null };
  const { data, error } = await admin.from("contacts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", personId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await logPersonActivity(admin, {
    contactId: personId,
    title: inactive ? "Marked inactive" : "Marked active",
    createdBy: userId,
    interactionType: "status_change",
  });
  return { person: data };
}

export async function changePrimaryCompany(
  admin: SupabaseClient,
  personId: string,
  companyId: string,
  userId: string,
  role: CrmPersonRole,
): Promise<Record<string, unknown>> {
  if (!isCrmEditor(role)) throw new Error("You do not have permission to change associations.");
  const { data: company } = await admin.from("clients").select("id, name").eq("id", companyId).maybeSingle();
  if (!company) throw new Error("Company not found.");

  await admin.from("company_people").upsert({
    company_id: companyId,
    person_id: personId,
    relationship_type: "client_contact",
    is_primary: true,
  }, { onConflict: "company_id,person_id,relationship_type" });

  await admin.from("company_people").update({ is_primary: false })
    .eq("person_id", personId)
    .neq("company_id", companyId);

  const result = await updatePersonRecord(admin, personId, userId, role, {
    client_id: companyId,
    company: company.name,
  });

  return result;
}

export {
  deleteCrmPerson,
  mergeCrmPeople,
};
