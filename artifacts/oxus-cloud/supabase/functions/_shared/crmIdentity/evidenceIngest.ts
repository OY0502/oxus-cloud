/**
 * Evidence-only ingestion for CRM resolver v2 Google sync paths.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  extractDomainFromEmail,
  normalizeEmail,
  type GoogleConnectionRow,
} from "../google-auth.ts";
import { parseDomainInput } from "../crm/domain.ts";
import { classifyAttendeeExclusion } from "./exclusion.ts";

export function usesCrmResolverV2(connection: GoogleConnectionRow): boolean {
  const version = (connection as GoogleConnectionRow & { crm_resolver_version?: number }).crm_resolver_version;
  return (version ?? 1) >= 2;
}

export async function ingestCalendarAttendees(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  args: {
    calendarEventId: string | null;
    externalEventId: string;
    externalCalendarId: string;
    eventStartAt: string;
    eventStatus: string;
    attendees: Array<{ email?: string; displayName?: string; resource?: boolean; self?: boolean; responseStatus?: string }>;
  },
): Promise<number> {
  let count = 0;
  for (const att of args.attendees) {
    const email = normalizeEmail(att.email ?? "");
    if (!email) continue;
    const exclusion = classifyAttendeeExclusion({
      email,
      connectedAccountEmail: connection.google_email,
      displayName: att.displayName,
      resource: att.resource,
    });
    const domain = parseDomainInput(extractDomainFromEmail(email) ?? "").registrableDomain;

    const { error } = await admin.from("google_calendar_attendees").upsert({
      connection_id: connection.id,
      owner_user_id: connection.user_id,
      calendar_event_id: args.calendarEventId,
      external_event_id: args.externalEventId,
      external_calendar_id: args.externalCalendarId,
      attendee_email: email,
      normalized_email: email,
      display_name: att.displayName ?? null,
      response_status: att.responseStatus ?? null,
      is_resource: att.resource ?? false,
      is_self: att.self ?? false,
      event_start_at: args.eventStartAt,
      event_status: args.eventStatus,
      registrable_domain: domain,
      exclusion_reason: exclusion,
      processing_status: exclusion ? "suppressed" : "pending",
      source_confidence: exclusion ? 0 : 0.88,
      raw_metadata: att,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "connection_id,external_calendar_id,external_event_id,normalized_email" });
    if (!error) count++;
  }
  return count;
}

export async function ingestGoogleContactSource(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  args: {
    externalId: string;
    email: string;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    organization?: string | null;
    jobTitle?: string | null;
    photoUrl?: string | null;
    resourceName?: string | null;
    rawMetadata?: Record<string, unknown>;
  },
): Promise<void> {
  const email = normalizeEmail(args.email);
  if (!email) return;
  const domain = parseDomainInput(extractDomainFromEmail(email) ?? "").registrableDomain;

  await admin.from("crm_source_people").upsert({
    owner_user_id: connection.user_id,
    connection_id: connection.id,
    provider: "google",
    source_type: "google_contact",
    external_id: args.externalId,
    normalized_email: email,
    display_name: args.displayName,
    structured_first_name: args.firstName,
    structured_last_name: args.lastName,
    organization_name: args.organization,
    job_title: args.jobTitle,
    photo_url: args.photoUrl,
    registrable_domain: domain,
    source_confidence: 0.92,
    raw_metadata: {
      ...(args.rawMetadata ?? {}),
      resource_name: args.resourceName,
      photo_url: args.photoUrl,
    },
    processing_status: "pending",
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "owner_user_id,provider,source_type,external_id" });
}
