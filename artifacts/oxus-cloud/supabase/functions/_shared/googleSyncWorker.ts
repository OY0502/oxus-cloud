import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getValidGoogleAccessToken,
  getGooglePeopleApiBaseUrl,
  googleApiFetch,
  GoogleSyncError,
  isAutomatedSender,
  isInternalOxusEmail,
  normalizeDomain,
  normalizeEmail,
  type GoogleConnectionRow,
} from "./google-auth.ts";
import { isSuppressed } from "./crmEntityResolution.ts";
import { collectParticipantEmails, parseGmailMessage } from "./googleEmailProcessing.ts";
import { triggerDevTask, shouldQueueTriggerDevTasks } from "./agent/triggerDev.ts";
import {
  bump,
  processContactSignal,
  upsertSyncState,
  type SyncCounts,
} from "./googleSyncState.ts";
import {
  ensureDefaultCalendarSelection,
  fetchGoogleCalendarList,
  getEnabledCalendarIds,
} from "./googleCalendarHelpers.ts";

export type { SyncCounts };
export { bump, processContactSignal, upsertSyncState };

async function updateImportRunProgress(
  admin: SupabaseClient,
  importRunId: string | null | undefined,
  patch: {
    progress_stage?: string;
    progress_processed?: number;
    progress_total?: number;
    progress_percentage?: number;
    counts?: SyncCounts;
  },
) {
  if (!importRunId) return;
  const update: Record<string, unknown> = { ...patch };
  if (patch.counts) update.counts = patch.counts;
  await admin.from("google_import_runs").update(update).eq("id", importRunId);
}

function progressFromCounts(counts: SyncCounts, stage: string): { processed: number; total?: number; percentage?: number } {
  const scanned = (counts.contacts_scanned ?? 0) + (counts.events_scanned ?? 0) + (counts.messages_scanned ?? 0);
  if (stage === "syncing_contacts" && counts.contacts_total) {
    const total = counts.contacts_total;
    return { processed: counts.contacts_scanned ?? 0, total, percentage: Math.min(100, Math.round(((counts.contacts_scanned ?? 0) / total) * 100)) };
  }
  return { processed: scanned };
}

export async function syncGoogleContacts(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  importRunId?: string,
): Promise<void> {
  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const { data: syncState } = await admin
    .from("google_sync_states")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("source", "contacts")
    .eq("resource_key", "default")
    .maybeSingle();

  let url = "/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,photos,metadata&pageSize=100";
  if (syncState?.sync_token) {
    url = `/v1/people/me/connections?syncToken=${encodeURIComponent(syncState.sync_token)}&personFields=names,emailAddresses,phoneNumbers,organizations,photos,metadata&pageSize=100`;
  }

  let nextPageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const resp = await googleApiFetch(accessToken, nextPageToken ? `${url}&pageToken=${nextPageToken}` : url, {
      baseUrl: getGooglePeopleApiBaseUrl(),
    });
    const text = await resp.text();
    if (!resp.ok) {
      if (resp.status === 410 && syncState?.sync_token) {
        await admin.from("google_sync_states").update({ sync_token: null }).eq("id", syncState.id);
        return syncGoogleContacts(admin, connection, counts);
      }
      throw new Error(`Google Contacts sync failed: ${text.slice(0, 400)}`);
    }
    const payload = JSON.parse(text) as {
      connections?: Array<Record<string, unknown>>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    nextPageToken = payload.nextPageToken;
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;

    for (const person of payload.connections ?? []) {
      bump(counts, "contacts_scanned");
      if ((counts.contacts_scanned ?? 0) % 25 === 0) {
        const p = progressFromCounts(counts, "syncing_contacts");
        await updateImportRunProgress(admin, importRunId, {
          progress_stage: "syncing_contacts",
          progress_processed: p.processed,
          progress_total: p.total,
          progress_percentage: p.percentage,
          counts,
        });
      }
      const resourceName = String(person.resourceName ?? "");
      const metadata = person.metadata as { deleted?: boolean } | undefined;
      if (metadata?.deleted) continue;

      const emails = ((person.emailAddresses as Array<{ value?: string }>) ?? [])
        .map((e) => normalizeEmail(e.value)).filter(Boolean) as string[];
      const primaryEmail = emails[0] ?? null;
      if (!primaryEmail || isInternalOxusEmail(primaryEmail)) continue;
      if (await isSuppressed(admin, "email", primaryEmail, connection.user_id)) continue;

      const names = (person.names as Array<{ displayName?: string; givenName?: string; familyName?: string }>) ?? [];
      const displayName = names[0]?.displayName ?? primaryEmail;
      const orgs = (person.organizations as Array<{ name?: string; title?: string }>) ?? [];
      const orgName = orgs[0]?.name ?? null;
      const jobTitle = orgs[0]?.title ?? null;

      await admin.from("google_interactions").upsert(
        {
          connection_id: connection.id,
          owner_user_id: connection.user_id,
          interaction_type: "contact",
          external_id: resourceName || primaryEmail,
          occurred_at: new Date().toISOString(),
          subject: displayName,
          participant_emails: emails,
          snippet: orgName,
          metadata: { organization: orgName, job_title: jobTitle },
        },
        { onConflict: "connection_id,interaction_type,external_id" },
      );

      await processContactSignal(admin, connection, {
        email: primaryEmail,
        displayName,
        jobTitle,
        orgName,
        resourceName,
        emails,
      }, counts);
    }
  } while (nextPageToken);

  await upsertSyncState(admin, connection, "contacts", "default", {
    sync_token: nextSyncToken ?? syncState?.sync_token ?? null,
    initial_sync_completed: true,
    last_attempted_sync_at: new Date().toISOString(),
    last_successful_sync_at: new Date().toISOString(),
    last_error: null,
    next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
}

export async function syncGoogleCalendar(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  importRunId?: string,
): Promise<void> {
  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const settings = connection.import_settings as Record<string, unknown>;
  const lookbackMonths = Number(settings.lookback_months ?? 12) || 12;
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - lookbackMonths);
  const timeMax = new Date();
  timeMax.setMonth(timeMax.getMonth() + 6);

  // Use the same calendar selection + exclusion rules as the batch importer
  // (exclude holiday/birthday group calendars; honor selected_calendars).
  const connWithCalendars = await ensureDefaultCalendarSelection(admin, connection);
  let calendarIds = getEnabledCalendarIds(connWithCalendars) ?? [];
  if (calendarIds.length === 0) {
    const listed = await fetchGoogleCalendarList(accessToken);
    calendarIds = listed.map((c) => c.id);
  }
  const calendars = calendarIds.map((id) => ({ id, summary: id }));

  for (const cal of calendars) {
    const calendarId = cal.id;
    if (!calendarId) continue;
    const resourceKey = calendarId;

    const { data: syncState } = await admin
      .from("google_sync_states")
      .select("*")
      .eq("connection_id", connection.id)
      .eq("source", "calendar")
      .eq("resource_key", resourceKey)
      .maybeSingle();

    let eventsUrl = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&maxResults=250&timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
    if (syncState?.sync_token) {
      eventsUrl = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?syncToken=${encodeURIComponent(syncState.sync_token)}`;
    }

    const resp = await googleApiFetch(accessToken, eventsUrl);
    const text = await resp.text();
    if (!resp.ok) {
      if (resp.status === 410 && syncState?.sync_token) {
        await admin.from("google_sync_states").update({ sync_token: null }).eq("id", syncState.id);
        continue;
      }
      throw new Error(`Calendar sync failed: ${text.slice(0, 400)}`);
    }

    const payload = JSON.parse(text) as {
      items?: Array<Record<string, unknown>>;
      nextSyncToken?: string;
    };

    for (const event of payload.items ?? []) {
      bump(counts, "events_scanned");
      if ((counts.events_scanned ?? 0) % 25 === 0) {
        const p = progressFromCounts(counts, "syncing_calendar");
        await updateImportRunProgress(admin, importRunId, {
          progress_stage: "syncing_calendar",
          progress_processed: p.processed,
          progress_total: p.total,
          progress_percentage: p.percentage,
          counts,
        });
      }
      const eventId = String(event.id ?? "");
      if (!eventId) continue;
      const status = String(event.status ?? "confirmed");
      const start = (event.start as { dateTime?: string; date?: string }) ?? {};
      const occurredAt = start.dateTime ?? start.date ?? new Date().toISOString();
      const attendees = ((event.attendees as Array<{ email?: string; displayName?: string }>) ?? [])
        .map((a) => normalizeEmail(a.email)).filter(Boolean) as string[];
      const organizer = (event.organizer as { email?: string })?.email ?? null;

      if (status === "cancelled") {
        await admin.from("calendar_events").update({ cancelled_at: new Date().toISOString() })
          .eq("connection_id", connection.id)
          .eq("external_calendar_id", calendarId)
          .eq("external_id", eventId);
        continue;
      }

      await admin.from("calendar_events").upsert(
        {
          title: String(event.summary ?? "Untitled meeting"),
          event_date: occurredAt.slice(0, 10),
          start_time: start.dateTime ? occurredAt.slice(11, 16) : null,
          end_time: (event.end as { dateTime?: string })?.dateTime?.slice(11, 16) ?? null,
          type: "meeting",
          location: String(event.location ?? "") || null,
          provider: "google",
          external_id: eventId,
          external_calendar_id: calendarId,
          connection_id: connection.id,
          owner_user_id: connection.user_id,
          organizer_email: organizer,
          attendee_emails: attendees,
          meeting_url: (event.hangoutLink as string) ?? null,
          html_link: (event.htmlLink as string) ?? null,
          metadata: { calendar_summary: cal.summary },
        },
        { onConflict: "connection_id,external_calendar_id,external_id", ignoreDuplicates: false },
      );

      await admin.from("google_interactions").upsert(
        {
          connection_id: connection.id,
          owner_user_id: connection.user_id,
          interaction_type: "calendar_event",
          external_id: `${calendarId}:${eventId}`,
          occurred_at: occurredAt,
          subject: String(event.summary ?? ""),
          organizer_email: organizer,
          attendee_emails: attendees,
          participant_emails: attendees,
          snippet: String(event.description ?? "").slice(0, 500) || null,
          metadata: { html_link: event.htmlLink, calendar_id: calendarId },
        },
        { onConflict: "connection_id,interaction_type,external_id" },
      );

      for (const email of attendees) {
        if (isInternalOxusEmail(email) || isAutomatedSender(email)) continue;
        if (await isSuppressed(admin, "email", email, connection.user_id)) continue;
        const personMatch = await resolvePersonByEmail(admin, email);
        if (!personMatch) {
          bump(counts, "attendee_candidates");
          await admin.from("crm_entity_candidates").upsert(
            {
              owner_user_id: connection.user_id,
              connection_id: connection.id,
              entity_type: "person",
              status: "pending",
              display_name: email,
              email,
              confidence: 0.7,
              evidence: { calendar_meeting: String(event.summary ?? ""), event_id: eventId },
              sources: ["calendar"],
              reason: "Meeting attendee",
            },
            { onConflict: "owner_user_id,entity_type,email", ignoreDuplicates: true },
          );
        }
      }
    }

    await upsertSyncState(admin, connection, "calendar", resourceKey, {
      sync_token: payload.nextSyncToken ?? syncState?.sync_token ?? null,
      initial_sync_completed: true,
      last_attempted_sync_at: new Date().toISOString(),
      last_successful_sync_at: new Date().toISOString(),
      last_error: null,
      next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }
}

export async function syncGoogleGmail(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  importRunId?: string,
): Promise<void> {
  if (!(connection.sources_enabled as Record<string, boolean>)?.gmail) return;
  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const settings = connection.import_settings as Record<string, unknown>;
  const includeContent = settings.include_gmail_content === true;
  const lookbackMonths = Number(settings.lookback_months ?? 12) || 12;
  const afterDate = new Date();
  afterDate.setMonth(afterDate.getMonth() - lookbackMonths);
  const afterTs = Math.floor(afterDate.getTime() / 1000);

  const { data: syncState } = await admin
    .from("google_sync_states")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("source", "gmail")
    .eq("resource_key", "default")
    .maybeSingle();

  if (syncState?.history_id) {
    const histResp = await googleApiFetch(
      accessToken,
      `/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(syncState.history_id)}&historyTypes=messageAdded`,
    );
    const histText = await histResp.text();
    if (histResp.status === 404) {
      await admin.from("google_sync_states").update({ history_id: null }).eq("id", syncState.id);
    } else if (histResp.ok) {
      const hist = JSON.parse(histText) as { history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>; historyId?: string };
      for (const record of hist.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const msgId = added.message?.id;
          if (msgId) await processGmailMessage(admin, connection, accessToken, msgId, includeContent, counts);
        }
      }
      await upsertSyncState(admin, connection, "gmail", "default", {
        history_id: hist.historyId ?? syncState.history_id,
        initial_sync_completed: true,
        last_successful_sync_at: new Date().toISOString(),
        last_attempted_sync_at: new Date().toISOString(),
        next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      return;
    }
  }

  const listResp = await googleApiFetch(
    accessToken,
    `/gmail/v1/users/me/messages?q=${encodeURIComponent(`after:${afterTs} -in:spam -in:trash`)}&maxResults=100`,
  );
  const listText = await listResp.text();
  if (!listResp.ok) throw new Error(`Gmail list failed: ${listText.slice(0, 400)}`);
  const list = JSON.parse(listText) as { messages?: Array<{ id?: string }>; historyId?: string };

  for (const msg of list.messages ?? []) {
    if (msg.id) await processGmailMessage(admin, connection, accessToken, msg.id, includeContent, counts);
  }

  const profileResp = await googleApiFetch(accessToken, "/gmail/v1/users/me/profile");
  const profile = profileResp.ok ? await profileResp.json() as { historyId?: string } : {};

  await upsertSyncState(admin, connection, "gmail", "default", {
    history_id: profile.historyId ?? list.historyId ?? syncState?.history_id ?? null,
    initial_sync_completed: true,
    last_attempted_sync_at: new Date().toISOString(),
    last_successful_sync_at: new Date().toISOString(),
    last_error: null,
    next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
}

export async function processGmailMessage(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  accessToken: string,
  messageId: string,
  includeContent: boolean,
  counts: SyncCounts,
  preParsed?: ReturnType<typeof parseGmailMessage>,
) {
  bump(counts, "email_threads_scanned");
  let parsed = preParsed;
  if (!parsed) {
    const resp = await googleApiFetch(accessToken, `/gmail/v1/users/me/messages/${messageId}?format=full`);
    if (!resp.ok) return;
    const message = await resp.json() as Record<string, unknown>;
    parsed = parseGmailMessage(message, connection.google_email, includeContent);
  }
  if (isAutomatedSender(parsed.fromEmail)) return;

  const participants = collectParticipantEmails(parsed);
  const externalParticipants = participants.filter((e) => !isInternalOxusEmail(e));
  if (externalParticipants.length === 0) return;

  const classification = await classifyGoogleInteraction({
    interactionType: "email",
    subject: parsed.subject,
    snippet: parsed.bodyExcerpt ?? parsed.snippet,
    participantEmails: participants,
    direction: parsed.direction,
    trace: { connection_id: connection.id, message_id: messageId },
  });

  if (!classification.relevant || classification.importance === "ignore") {
    bump(counts, "ignored_records");
    return;
  }

  await admin.from("google_interactions").upsert(
    {
      connection_id: connection.id,
      owner_user_id: connection.user_id,
      interaction_type: "email",
      external_id: parsed.messageId,
      external_thread_id: parsed.threadId,
      occurred_at: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
      subject: parsed.subject,
      participant_emails: participants,
      direction: parsed.direction,
      snippet: parsed.snippet,
      ai_summary: classification.summary,
      classification: classification.company_type,
      importance: classification.importance,
      metadata: { signature_hints: parsed.signatureHints, commercial_opportunity: classification.commercial_opportunity },
    },
    { onConflict: "connection_id,interaction_type,external_id" },
  );

  for (const email of externalParticipants) {
    if (await isSuppressed(admin, "email", email, connection.user_id)) continue;
    const personMatch = await resolvePersonByEmail(admin, email);
    const settings = connection.import_settings as Record<string, unknown>;
    if (!personMatch && classification.confidence >= 0.65 && settings.uncertain_to_review !== false) {
      await admin.from("crm_entity_candidates").upsert(
        {
          owner_user_id: connection.user_id,
          connection_id: connection.id,
          entity_type: "person",
          status: "pending",
          display_name: parsed.fromName ?? email,
          email,
          job_title: classification.detected_job_title ?? parsed.signatureHints.jobTitle ?? null,
          company_name: classification.detected_company_name,
          domain: classification.detected_company_domain,
          suggested_relationship_type: classification.person_relationship,
          confidence: classification.confidence,
          evidence: { email_threads: 1, summary: classification.summary },
          sources: ["gmail"],
          reason: classification.summary,
        },
        { onConflict: "owner_user_id,entity_type,email", ignoreDuplicates: true },
      );
      bump(counts, "candidates_created");
    }
    if (classification.commercial_opportunity && classification.confidence >= 0.75) {
      await admin.from("crm_entity_candidates").upsert(
        {
          owner_user_id: connection.user_id,
          connection_id: connection.id,
          entity_type: "lead",
          status: "pending",
          display_name: classification.summary.slice(0, 120) || parsed.subject || "Potential lead",
          email,
          company_name: classification.detected_company_name,
          domain: classification.detected_company_domain,
          confidence: classification.confidence,
          evidence: { opportunity_signals: classification.opportunity_signals, subject: parsed.subject },
          sources: ["gmail"],
          reason: classification.summary,
        },
        { onConflict: "owner_user_id,entity_type,email", ignoreDuplicates: true },
      );
    }
  }
}

/** @deprecated Use runGoogleImportBatch from googleSyncBatch.ts — one bounded batch per invocation. */
export async function runGoogleImport(
  admin: SupabaseClient,
  importRunId: string,
  context?: { correlationId?: string; triggerRunId?: string | null },
): Promise<{ counts: SyncCounts; status: string }> {
  const { runGoogleImportBatch } = await import("./googleSyncBatch.ts");
  await runGoogleImportBatch(admin, importRunId, "validate", {
    correlationId: context?.correlationId,
    triggerRunId: context?.triggerRunId,
  });
  throw new GoogleSyncError(
    "DEPRECATED_SYNC_PATH",
    "Full import in one request is disabled. Use Trigger.dev orchestrated batches.",
  );
}

export { queueGoogleImport } from "./googleSyncBatch.ts";
