/**
 * Deterministic CRM entity creation without AI — Contacts, Calendar, Gmail metadata.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  extractDomainFromEmail,
  isAutomatedSender,
  isFreeEmailDomain,
  isInternalOxusEmail,
  normalizeEmail,
  type GoogleConnectionRow,
} from "./google-auth.ts";
import { isSuppressed } from "./crmEntityResolution.ts";
import {
  domainToDisplayCompanyName,
  resolveOrCreateCompany,
  resolveOrCreatePerson,
} from "./crmGoogleEntityProcessing.ts";
import type { SyncCounts } from "./googleSyncWorker.ts";

export function bump(counts: SyncCounts, key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

import { classifyEmailSender, isNumericIdentity } from "./crm/senderClassification.ts";

export function displayNameFromEmail(email: string): string {
  const sender = classifyEmailSender(email);
  if (sender.isRoleInbox) return "General inbox";
  if (sender.isAutomated) return "Automated sender";
  const local = email.split("@")[0] ?? email;
  if (isNumericIdentity(local)) return "Unknown contact";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export async function resolveBasicPersonFromEmail(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  args: {
    email: string;
    displayName?: string | null;
    jobTitle?: string | null;
    companyId?: string | null;
    sourceType: string;
    sourceId?: string;
    evidence?: Record<string, unknown>;
  },
  counts: SyncCounts,
): Promise<string | null> {
  const email = normalizeEmail(args.email);
  if (!email || isInternalOxusEmail(email) || isAutomatedSender(email)) return null;
  if (await isSuppressed(admin, "email", email, connection.user_id)) return null;

  const name = args.displayName?.trim() && !args.displayName.includes("@")
    ? args.displayName.trim()
    : displayNameFromEmail(email);

  return resolveOrCreatePerson(admin, connection, {
    email,
    displayName: name,
    jobTitle: args.jobTitle ?? null,
    companyId: args.companyId ?? null,
    sourceType: args.sourceType,
    sourceId: args.sourceId ?? email,
    confidence: 0.92,
    evidence: args.evidence ?? { source: args.sourceType },
    updateExisting: true,
  }, counts);
}

export async function resolveBasicCompanyFromEmail(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  email: string,
  sourceType: string,
  sourceId: string,
  counts: SyncCounts,
  suggestedName?: string | null,
): Promise<string | null> {
  const domain = extractDomainFromEmail(email);
  if (!domain || isFreeEmailDomain(domain) || isAutomatedSender(email)) return null;

  return resolveOrCreateCompany(admin, connection, {
    domain,
    suggestedName: suggestedName ?? domainToDisplayCompanyName(domain),
    sourceType,
    sourceId,
    confidence: 0.92,
    evidence: { email, domain },
  }, counts);
}

export async function resolveBasicEntitiesFromGmailThreadRow(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  row: {
    thread_id: string;
    subject?: string | null;
    participant_emails?: string[] | null;
    primary_external_email?: string | null;
  },
  counts: SyncCounts,
): Promise<void> {
  const participants = (row.participant_emails ?? [])
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => !!e && !isInternalOxusEmail(e) && !isAutomatedSender(e));

  const primary = normalizeEmail(row.primary_external_email ?? participants[0] ?? "");
  if (!primary) return;

  const companyId = await resolveBasicCompanyFromEmail(
    admin,
    connection,
    primary,
    "gmail_metadata",
    row.thread_id,
    counts,
  );

  await resolveBasicPersonFromEmail(admin, connection, {
    email: primary,
    companyId,
    sourceType: "gmail_metadata",
    sourceId: row.thread_id,
    evidence: { subject: row.subject, thread_id: row.thread_id },
  }, counts);

  bump(counts, "threads_metadata_resolved");
}

export async function batchResolveBasicFromGmailMetadata(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  importRunId: string,
  limit: number,
  counts: SyncCounts,
): Promise<{ processed: number; done: boolean }> {
  const { data: rows } = await admin
    .from("google_gmail_threads")
    .select("id, thread_id, subject, participant_emails, metadata")
    .eq("connection_id", connection.id)
    .in("relevance_status", ["relevant", "discovered"])
    .is("deterministic_resolved_at", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (!rows?.length) return { processed: 0, done: true };

  for (const row of rows) {
    const primary = (row.metadata as Record<string, unknown>)?.primary_external_email as string | undefined;
    await resolveBasicEntitiesFromGmailThreadRow(admin, connection, {
      thread_id: row.thread_id,
      subject: row.subject,
      participant_emails: row.participant_emails as string[],
      primary_external_email: primary,
    }, counts);

    await admin.from("google_gmail_threads").update({
      deterministic_resolved_at: new Date().toISOString(),
      enrichment_status: "metadata_resolved",
    }).eq("id", row.id);
  }

  const { count: remaining } = await admin
    .from("google_gmail_threads")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .in("relevance_status", ["relevant", "discovered"])
    .is("deterministic_resolved_at", null);

  return { processed: rows.length, done: (remaining ?? 0) === 0 };
}

export async function resolveBasicFromContactInteraction(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  contact: {
    email: string;
    displayName: string;
    jobTitle?: string | null;
    orgName?: string | null;
    resourceName?: string;
  },
  counts: SyncCounts,
): Promise<void> {
  const companyId = contact.orgName
    ? await resolveOrCreateCompany(admin, connection, {
      domain: extractDomainFromEmail(contact.email) ?? contact.orgName,
      suggestedName: contact.orgName,
      sourceType: "google_contacts",
      sourceId: contact.resourceName ?? contact.email,
      confidence: 0.95,
      evidence: { organization: contact.orgName },
    }, counts)
    : await resolveBasicCompanyFromEmail(
      admin,
      connection,
      contact.email,
      "google_contacts",
      contact.resourceName ?? contact.email,
      counts,
      contact.orgName,
    );

  await resolveBasicPersonFromEmail(admin, connection, {
    email: contact.email,
    displayName: contact.displayName,
    jobTitle: contact.jobTitle,
    companyId,
    sourceType: "google_contacts",
    sourceId: contact.resourceName ?? contact.email,
    evidence: { organization: contact.orgName, job_title: contact.jobTitle },
  }, counts);
}

export async function resolveBasicFromCalendarAttendee(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  email: string,
  displayName: string | null,
  eventId: string,
  counts: SyncCounts,
): Promise<void> {
  const companyId = await resolveBasicCompanyFromEmail(
    admin,
    connection,
    email,
    "google_calendar",
    eventId,
    counts,
  );
  await resolveBasicPersonFromEmail(admin, connection, {
    email,
    displayName,
    companyId,
    sourceType: "google_calendar",
    sourceId: eventId,
    evidence: { calendar_event: eventId },
  }, counts);
}
