/**
 * Google → CRM entity resolution: people, companies, candidates, activities.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  extractDomainFromEmail,
  isAutomatedSender,
  isFreeEmailDomain,
  isInternalOxusEmail,
  normalizeDomain,
  normalizeEmail,
  type GoogleConnectionRow,
} from "./google-auth.ts";
import {
  canOverwriteField,
  recordEntitySource,
  resolveCompanyByDomain,
  resolveCompanyFromEmail,
  resolvePersonByEmail,
} from "./crmEntityResolution.ts";
import { parseDomainInput } from "./crm/domain.ts";
import { classifyEmailSender, resolvePlatformCompany, shouldCreateCompanyFromDomain } from "./crm/senderClassification.ts";
import type { SyncCounts } from "./googleSyncWorker.ts";

export function bump(counts: SyncCounts, key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

export function domainToDisplayCompanyName(domain: string): string {
  const platform = resolvePlatformCompany(domain);
  if (platform) return platform;
  const parsed = parseDomainInput(domain);
  const registrable = parsed.registrableDomain ?? domain;
  const base = registrable.split(".")[0] ?? registrable;
  if (!base) return domain;
  if (base.length <= 3) return base.toUpperCase();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function eventDateFromGoogleStart(start: { dateTime?: string; date?: string }): string {
  if (start.date) return start.date;
  if (start.dateTime) return start.dateTime.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export function computeContactConfidence(args: {
  email: string;
  displayName: string;
  orgName: string | null;
  hasExistingPerson: boolean;
}): number {
  if (args.hasExistingPerson) return 0.95;
  const domain = extractDomainFromEmail(args.email);
  const corporate = domain && !isFreeEmailDomain(domain);
  const hasName = args.displayName.trim().length > 0 && !args.displayName.includes("@");
  if (corporate && args.orgName && hasName) return 0.95;
  if (corporate && hasName) return 0.92;
  if (corporate) return 0.88;
  if (hasName) return 0.72;
  return 0.55;
}

async function upsertPersonCandidate(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  input: {
    displayName: string;
    email: string;
    jobTitle?: string | null;
    companyName?: string | null;
    domain?: string | null;
    confidence: number;
    sources: string[];
    reason: string;
    evidence: Record<string, unknown>;
    matchedPersonId?: string | null;
    matchedCompanyId?: string | null;
    relationshipType?: string | null;
  },
  counts: SyncCounts,
): Promise<void> {
  const settings = connection.import_settings as Record<string, unknown>;
  if (settings.uncertain_to_review === false) return;
  if (input.confidence < 0.65) {
    bump(counts, "records_ignored_low_confidence");
    return;
  }
  await admin.from("crm_entity_candidates").upsert(
    {
      owner_user_id: connection.user_id,
      connection_id: connection.id,
      entity_type: "person",
      status: "pending",
      display_name: input.displayName,
      email: input.email,
      job_title: input.jobTitle ?? null,
      company_name: input.companyName ?? null,
      domain: input.domain ?? null,
      suggested_relationship_type: input.relationshipType ?? null,
      confidence: input.confidence,
      evidence: input.evidence,
      sources: input.sources,
      reason: input.reason,
      matched_person_id: input.matchedPersonId ?? null,
      matched_company_id: input.matchedCompanyId ?? null,
    },
    { onConflict: "owner_user_id,entity_type,email", ignoreDuplicates: false },
  );
  bump(counts, "candidates_created");
}

async function upsertCompanyCandidate(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  input: {
    displayName: string;
    domain: string;
    website?: string | null;
    confidence: number;
    sources: string[];
    reason: string;
    evidence: Record<string, unknown>;
    matchedCompanyId?: string | null;
  },
  counts: SyncCounts,
): Promise<void> {
  const settings = connection.import_settings as Record<string, unknown>;
  if (settings.uncertain_to_review === false) return;
  if (input.confidence < 0.65) {
    bump(counts, "records_ignored_low_confidence");
    return;
  }
  await admin.from("crm_entity_candidates").upsert(
    {
      owner_user_id: connection.user_id,
      connection_id: connection.id,
      entity_type: "company",
      status: "pending",
      display_name: input.displayName,
      domain: input.domain,
      website: input.website ?? `https://${input.domain}`,
      confidence: input.confidence,
      evidence: input.evidence,
      sources: input.sources,
      reason: input.reason,
      matched_company_id: input.matchedCompanyId ?? null,
    },
    { onConflict: "owner_user_id,entity_type,domain", ignoreDuplicates: false },
  );
  bump(counts, "candidates_created");
}

export async function resolveOrCreateCompany(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  args: {
    domain: string;
    suggestedName?: string | null;
    sourceType: string;
    sourceId?: string;
    confidence: number;
    evidence: Record<string, unknown>;
  },
  counts: SyncCounts,
): Promise<string | null> {
  const domain = normalizeDomain(args.domain);
  if (!domain || isFreeEmailDomain(domain) || !shouldCreateCompanyFromDomain(domain)) return null;
  const parsed = parseDomainInput(domain);
  const registrableDomain = parsed.registrableDomain ?? domain;

  const existing = await resolveCompanyByDomain(admin, registrableDomain);
  if (existing) {
    bump(counts, "companies_updated");
    await recordEntitySource(admin, "company", existing.company_id, args.sourceType, args.sourceId, args.confidence);
    return existing.company_id;
  }

  const settings = connection.import_settings as Record<string, unknown>;
  const autoCreate = settings.auto_create_high_confidence !== false;
  const name = args.suggestedName?.trim() || domainToDisplayCompanyName(registrableDomain);
  const platformName = resolvePlatformCompany(registrableDomain);
  const companyType = platformName ? "tool" : "unknown";
  const qualityStatus = args.confidence >= 0.85 ? "accepted" : args.confidence >= 0.55 ? "needs_review" : "suppressed";

  if (args.confidence >= 0.9 && autoCreate) {
    const { data: created, error } = await admin.from("clients").insert({
      name,
      display_name: name,
      normalized_name: name.toLowerCase(),
      primary_domain: registrableDomain,
      registrable_domain: registrableDomain,
      normalized_host: parsed.normalizedHost,
      host_subdomain: parsed.subdomain,
      website: `https://${registrableDomain}`,
      company_type: companyType,
      source: "Google Contacts",
      relationship_owner_id: connection.user_id,
      enrichment_status: "pending",
      name_confidence: args.confidence,
      name_source: platformName ? "platform_resolution" : "domain_derived",
      import_confidence: args.confidence,
      import_confidence_band: args.confidence >= 0.85 ? "high" : "medium",
      data_quality_status: qualityStatus,
      needs_review: qualityStatus === "needs_review",
    }).select("id").single();
    if (error || !created?.id) {
      bump(counts, "processing_errors");
      return null;
    }
    bump(counts, "companies_created");
    await recordEntitySource(admin, "company", created.id, args.sourceType, args.sourceId ?? domain, args.confidence);
    await admin.from("company_provider_mappings").upsert(
      { company_id: created.id, provider: "google", external_id: domain, metadata: args.evidence },
      { onConflict: "provider,external_id" },
    );
    return created.id;
  }

  if (args.confidence >= 0.65) {
    await upsertCompanyCandidate(admin, connection, {
      displayName: name,
      domain,
      website: `https://${domain}`,
      confidence: args.confidence,
      sources: [args.sourceType.replace(/_/g, " ")],
      reason: "Company inferred from Google data",
      evidence: args.evidence,
    }, counts);
    bump(counts, "company_candidates");
  } else {
    bump(counts, "records_ignored_low_confidence");
  }
  return null;
}

export async function resolveOrCreatePerson(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  args: {
    email: string;
    displayName: string;
    jobTitle?: string | null;
    orgName?: string | null;
    companyId?: string | null;
    resourceName?: string | null;
    sourceType: string;
    sourceId?: string;
    confidence: number;
    relationshipType?: string | null;
    evidence: Record<string, unknown>;
    updateExisting?: boolean;
  },
  counts: SyncCounts,
): Promise<string | null> {
  const email = normalizeEmail(args.email);
  if (!email || isInternalOxusEmail(email) || isAutomatedSender(email)) {
    bump(counts, "records_ignored_internal");
    return null;
  }

  const personMatch = await resolvePersonByEmail(admin, email);
  if (personMatch && personMatch.confidence >= 0.9) {
    if (args.resourceName) {
      await admin.from("person_provider_mappings").upsert(
        {
          person_id: personMatch.person_id,
          provider: "google",
          external_id: args.resourceName,
          external_email: email,
        },
        { onConflict: "provider,external_id" },
      );
    }
    if (args.updateExisting !== false && args.companyId) {
      const { data: contact } = await admin.from("contacts").select("client_id, field_provenance, locked_fields, company").eq("id", personMatch.person_id).maybeSingle();
      if (contact && !contact.client_id && canOverwriteField(contact.locked_fields as string[], "client_id", contact.field_provenance as Record<string, unknown>, args.sourceType)) {
        await admin.from("contacts").update({ client_id: args.companyId }).eq("id", personMatch.person_id);
      }
    }
    bump(counts, "people_updated");
    await recordEntitySource(admin, "person", personMatch.person_id, args.sourceType, args.sourceId, args.confidence);
    return personMatch.person_id;
  }

  const settings = connection.import_settings as Record<string, unknown>;
  const autoCreate = settings.auto_create_high_confidence !== false;
  let companyId = args.companyId ?? null;
  if (!companyId) {
    const companyFromEmail = await resolveCompanyFromEmail(admin, email);
    companyId = companyFromEmail?.company_id ?? null;
  }

  if (args.confidence >= 0.9 && autoCreate) {
    const sender = classifyEmailSender(email);
    const qualityStatus = sender.isRoleInbox || args.confidence < 0.85 ? "needs_review" : "accepted";
    const personType = companyId ? "client" : "lead";
    const { data: created, error } = await admin.from("contacts").insert({
      name: args.displayName,
      display_name: args.displayName,
      first_name: args.displayName.split(" ")[0] ?? args.displayName,
      last_name: args.displayName.split(" ").slice(1).join(" ") || null,
      email,
      type: personType,
      client_id: companyId,
      company: args.orgName,
      job_title: args.jobTitle ?? null,
      source: args.sourceType === "google_contacts" ? "Google Contacts" : args.sourceType === "calendar" ? "Google Calendar" : "Gmail",
      relationship_type: args.relationshipType ?? (sender.isRoleInbox ? "client_contact" : "client_contact"),
      relationship_owner_id: connection.user_id,
      is_role_inbox: sender.isRoleInbox,
      role_inbox_label: sender.isRoleInbox ? email : null,
      name_confidence: args.confidence,
      name_source: sender.isRoleInbox ? "role_inbox" : "google_import",
      import_confidence: args.confidence,
      import_confidence_band: args.confidence >= 0.85 ? "high" : "medium",
      data_quality_status: qualityStatus,
      metadata: args.resourceName ? { google_resource: args.resourceName } : {},
    }).select("id").single();
    if (error || !created?.id) {
      bump(counts, "processing_errors");
      return null;
    }
    bump(counts, "people_created");
    await recordEntitySource(admin, "person", created.id, args.sourceType, args.sourceId, args.confidence);
    if (args.resourceName) {
      await admin.from("person_provider_mappings").upsert(
        { person_id: created.id, provider: "google", external_id: args.resourceName, external_email: email },
        { onConflict: "provider,external_id" },
      );
    }
    return created.id;
  }

  if (args.confidence >= 0.65) {
    await upsertPersonCandidate(admin, connection, {
      displayName: args.displayName,
      email,
      jobTitle: args.jobTitle,
      companyName: args.orgName,
      domain: extractDomainFromEmail(email),
      confidence: args.confidence,
      sources: [args.sourceType.replace(/_/g, " ")],
      reason: "Person discovered from Google data",
      evidence: args.evidence,
      matchedPersonId: personMatch?.person_id ?? null,
      matchedCompanyId: companyId,
      relationshipType: args.relationshipType,
    }, counts);
  } else {
    bump(counts, "records_ignored_low_confidence");
  }
  return personMatch?.person_id ?? null;
}

export async function processContactFromGoogle(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  contact: {
    email: string;
    displayName: string;
    jobTitle: string | null;
    orgName: string | null;
    resourceName: string;
    emails: string[];
  },
  counts: SyncCounts,
  options?: { aiConfidence?: number; relationshipType?: string | null },
): Promise<{ personId: string | null; companyId: string | null }> {
  const personMatch = await resolvePersonByEmail(admin, contact.email);
  let confidence = computeContactConfidence({
    email: contact.email,
    displayName: contact.displayName,
    orgName: contact.orgName,
    hasExistingPerson: !!(personMatch && personMatch.confidence >= 0.9),
  });
  if (options?.aiConfidence != null) {
    confidence = Math.max(confidence, options.aiConfidence);
  }

  const domain = extractDomainFromEmail(contact.email);
  let companyId: string | null = null;
  if (domain && !isFreeEmailDomain(domain)) {
    const orgName = contact.orgName?.trim() || domainToDisplayCompanyName(domain);
    const companyConfidence = contact.orgName ? 0.88 : 0.92;
    companyId = await resolveOrCreateCompany(admin, connection, {
      domain,
      suggestedName: orgName,
      sourceType: "google_contacts",
      sourceId: contact.resourceName,
      confidence: companyConfidence,
      evidence: { organization: contact.orgName, email_domain: domain },
    }, counts);
  } else if (contact.orgName && confidence >= 0.65 && confidence < 0.9) {
    bump(counts, "company_candidates");
  }

  const personId = await resolveOrCreatePerson(admin, connection, {
    email: contact.email,
    displayName: contact.displayName,
    jobTitle: contact.jobTitle,
    orgName: contact.orgName,
    companyId,
    resourceName: contact.resourceName,
    sourceType: "google_contacts",
    sourceId: contact.resourceName,
    confidence,
    relationshipType: options?.relationshipType ?? "client_contact",
    evidence: { saved_google_contact: true, emails: contact.emails },
  }, counts);

  return { personId, companyId };
}

export async function processCalendarAttendee(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  args: {
    email: string;
    displayName?: string;
    eventTitle: string;
    eventId: string;
    occurredAt: string;
  },
  counts: SyncCounts,
): Promise<string | null> {
  const email = normalizeEmail(args.email);
  if (!email || isInternalOxusEmail(email) || isAutomatedSender(email)) {
    bump(counts, "records_ignored_internal");
    return null;
  }

  let companyId: string | null = null;
  const domain = extractDomainFromEmail(email);
  if (domain && !isFreeEmailDomain(domain)) {
    companyId = await resolveOrCreateCompany(admin, connection, {
      domain,
      sourceType: "calendar",
      sourceId: args.eventId,
      confidence: 0.85,
      evidence: { calendar_meeting: args.eventTitle },
    }, counts);
  }

  const confidence = domain && !isFreeEmailDomain(domain) ? 0.85 : 0.7;
  return resolveOrCreatePerson(admin, connection, {
    email,
    displayName: args.displayName ?? email,
    companyId,
    sourceType: "calendar",
    sourceId: args.eventId,
    confidence,
    relationshipType: "client_contact",
    evidence: { calendar_meeting: args.eventTitle, event_id: args.eventId },
  }, counts);
}

export async function recordMeetingActivity(
  admin: SupabaseClient,
  args: {
    connection: GoogleConnectionRow;
    interactionId: string;
    title: string;
    occurredAt: string;
    companyId?: string | null;
    personIds?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { data: existing } = await admin
    .from("activities")
    .select("id")
    .eq("google_interaction_id", args.interactionId)
    .maybeSingle();
  if (existing?.id) return;

  await admin.from("activities").insert({
    type: "meeting",
    title: args.title,
    description: null,
    company_id: args.companyId ?? null,
    interaction_type: "calendar_event",
    occurred_at: args.occurredAt,
    source: "Google Calendar",
    google_interaction_id: args.interactionId,
    metadata: { person_ids: args.personIds ?? [], ...args.metadata ?? {} },
  });

  const occurredMs = new Date(args.occurredAt).getTime();
  const nowMs = Date.now();
  const isFuture = occurredMs > nowMs;
  if (args.companyId) {
    const { data: existing } = await admin
      .from("clients")
      .select("last_interaction_at, next_meeting_at")
      .eq("id", args.companyId)
      .maybeSingle();
    const patch: Record<string, unknown> = {};
    if (isFuture) {
      const currentNext = existing?.next_meeting_at ? new Date(existing.next_meeting_at).getTime() : Infinity;
      if (occurredMs < currentNext) patch.next_meeting_at = args.occurredAt;
    } else {
      const currentLast = existing?.last_interaction_at ? new Date(existing.last_interaction_at).getTime() : 0;
      if (occurredMs >= currentLast) patch.last_interaction_at = args.occurredAt;
    }
    if (Object.keys(patch).length) {
      await admin.from("clients").update(patch).eq("id", args.companyId);
    }
  }
  for (const personId of args.personIds ?? []) {
    const { data: existing } = await admin
      .from("contacts")
      .select("last_interaction_at, next_meeting_at")
      .eq("id", personId)
      .maybeSingle();
    const patch: Record<string, unknown> = {};
    if (isFuture) {
      const currentNext = existing?.next_meeting_at ? new Date(existing.next_meeting_at).getTime() : Infinity;
      if (occurredMs < currentNext) patch.next_meeting_at = args.occurredAt;
    } else {
      const currentLast = existing?.last_interaction_at ? new Date(existing.last_interaction_at).getTime() : 0;
      if (occurredMs >= currentLast) {
        patch.last_interaction_at = args.occurredAt;
        patch.last_contact_at = args.occurredAt.slice(0, 10);
        patch.last_interaction_type = "meeting";
      }
    }
    if (Object.keys(patch).length) {
      await admin.from("contacts").update(patch).eq("id", personId);
    }
  }
}

export async function processGoogleInteractionRow(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  row: {
    id: string;
    external_id: string;
    interaction_type: string;
    participant_emails: string[] | null;
    attendee_emails?: string[] | null;
    subject: string | null;
    occurred_at: string;
    metadata: Record<string, unknown> | null;
    organizer_email?: string | null;
  },
  counts: SyncCounts,
): Promise<{ companyId: string | null; personIds: string[] }> {
  const personIds: string[] = [];
  let companyId: string | null = null;

  if (row.interaction_type === "contact") {
    const emails = row.participant_emails ?? [];
    const primaryEmail = emails[0];
    if (!primaryEmail) return { companyId: null, personIds: [] };
    const meta = row.metadata ?? {};
    const result = await processContactFromGoogle(admin, connection, {
      email: primaryEmail,
      displayName: row.subject ?? primaryEmail,
      jobTitle: (meta.job_title as string) ?? null,
      orgName: (meta.organization as string) ?? null,
      resourceName: row.external_id,
      emails,
    }, counts);
    if (result.personId) personIds.push(result.personId);
    companyId = result.companyId;
  } else if (row.interaction_type === "calendar_event") {
    const attendees = row.attendee_emails ?? row.participant_emails ?? [];
    const eventId = String((row.metadata as { event_id?: string })?.event_id ?? row.id);
    for (const email of attendees) {
      const pid = await processCalendarAttendee(admin, connection, {
        email,
        eventTitle: row.subject ?? "Meeting",
        eventId,
        occurredAt: row.occurred_at,
      }, counts);
      if (pid) personIds.push(pid);
      // Never attach a meeting to a company solely because an internal OXUS attendee is present.
      if (!companyId && !isInternalOxusEmail(email)) {
        const domain = extractDomainFromEmail(email);
        if (domain && !isFreeEmailDomain(domain)) {
          const match = await resolveCompanyFromEmail(admin, email);
          companyId = match?.company_id ?? companyId;
        }
      }
    }
    await recordMeetingActivity(admin, {
      connection,
      interactionId: row.id,
      title: row.subject ?? "Meeting",
      occurredAt: row.occurred_at,
      companyId,
      personIds,
      metadata: row.metadata ?? {},
    });
    bump(counts, "calendar_meetings_imported");
  } else if (row.interaction_type === "email") {
    for (const email of row.participant_emails ?? []) {
      const pid = await resolveOrCreatePerson(admin, connection, {
        email,
        displayName: email,
        sourceType: "gmail",
        sourceId: row.id,
        confidence: 0.75,
        evidence: { subject: row.subject },
      }, counts);
      if (pid) personIds.push(pid);
    }
  }

  return { companyId, personIds };
}
