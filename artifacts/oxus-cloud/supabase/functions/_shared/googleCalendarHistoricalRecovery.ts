/**
 * Calendar-only historical completeness repair.
 * Preserves incremental sync_token; uses google_calendar_historical_cursors.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getValidGoogleAccessToken,
  googleApiFetch,
  isAutomatedSender,
  isInternalOxusEmail,
  normalizeEmail,
  type GoogleConnectionRow,
} from "./google-auth.ts";
import {
  ensureDefaultCalendarSelection,
  fetchGoogleCalendarList,
  getEnabledCalendarIds,
} from "./googleCalendarHelpers.ts";
import { eventDateFromGoogleStart } from "./crmGoogleEntityProcessing.ts";
import { ingestCalendarAttendees, usesCrmResolverV2 } from "./crmIdentity/evidenceIngest.ts";

const BATCH_EVENTS = 50;

export type HistoricalRecoveryDryRun = {
  connection_id: string;
  provider_account_id: string;
  calendars_to_process: Array<{ id: string; summary: string }>;
  calendars_excluded: Array<{ id: string; reason: string }>;
  historical_range: { time_min: string; time_max: string; lookback_months: number };
  existing_local_events: number;
  earliest_local_event: string | null;
  latest_local_event: string | null;
  estimated_provider_calls: number;
  note: string;
};

export type HistoricalRecoveryBatchResult = {
  done: boolean;
  dry_run: boolean;
  operation_id: string;
  calendar_id: string | null;
  events_read: number;
  events_stored: number;
  attendees_seen: number;
  page_token: string | null;
  sync_token_preserved: boolean;
  diagnostics: Record<string, unknown>;
};

function isNoiseCalendarId(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes("#holiday@")
    || lower.includes("#contacts@")
    || lower.includes("birthday")
    || lower.includes("@group.v.calendar.google.com")
    || lower.includes("@resource.calendar.google.com")
  );
}

export async function dryRunCalendarHistoricalRecovery(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  lookbackMonths = 36,
): Promise<HistoricalRecoveryDryRun> {
  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const listed = await fetchGoogleCalendarList(accessToken);
  const conn = await ensureDefaultCalendarSelection(admin, connection);
  const enabled = new Set(getEnabledCalendarIds(conn) ?? listed.filter((c) => c.primary).map((c) => c.id));

  const calendars_to_process = listed
    .filter((c) => enabled.has(c.id) && !isNoiseCalendarId(c.id))
    .map((c) => ({ id: c.id, summary: c.summary }));

  const calendars_excluded: Array<{ id: string; reason: string }> = [];
  for (const c of listed) {
    if (isNoiseCalendarId(c.id)) calendars_excluded.push({ id: c.id, reason: "noise_calendar" });
    else if (!enabled.has(c.id)) calendars_excluded.push({ id: c.id, reason: "not_selected" });
  }

  // Also exclude any local holiday sync states from processing
  const { data: syncStates } = await admin
    .from("google_sync_states")
    .select("resource_key")
    .eq("connection_id", connection.id)
    .eq("source", "calendar");
  for (const s of syncStates ?? []) {
    if (isNoiseCalendarId(s.resource_key) && !calendars_excluded.some((e) => e.id === s.resource_key)) {
      calendars_excluded.push({ id: s.resource_key, reason: "noise_calendar_local" });
    }
  }

  const timeMax = new Date();
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - lookbackMonths);

  const { count } = await admin
    .from("calendar_events")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id);

  const { data: bounds } = await admin
    .from("calendar_events")
    .select("event_date")
    .eq("connection_id", connection.id)
    .order("event_date", { ascending: true })
    .limit(1);
  const { data: latest } = await admin
    .from("calendar_events")
    .select("event_date")
    .eq("connection_id", connection.id)
    .order("event_date", { ascending: false })
    .limit(1);

  return {
    connection_id: connection.id,
    provider_account_id: connection.google_account_id,
    calendars_to_process,
    calendars_excluded,
    historical_range: {
      time_min: timeMin.toISOString(),
      time_max: timeMax.toISOString(),
      lookback_months: lookbackMonths,
    },
    existing_local_events: count ?? 0,
    earliest_local_event: bounds?.[0]?.event_date ?? null,
    latest_local_event: latest?.[0]?.event_date ?? null,
    estimated_provider_calls: Math.max(calendars_to_process.length * 3, 1),
    note: "Dry run only. Incremental sync_token will be preserved. No Gmail restart.",
  };
}

export async function runCalendarHistoricalRecoveryBatch(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  opts: {
    operation_id?: string;
    lookback_months?: number;
    dry_run?: boolean;
  } = {},
): Promise<HistoricalRecoveryBatchResult> {
  const dryRun = !!opts.dry_run;
  const lookbackMonths = Number(opts.lookback_months ?? 36) || 36;
  const operationId = opts.operation_id ?? crypto.randomUUID();

  if (dryRun) {
    const plan = await dryRunCalendarHistoricalRecovery(admin, connection, lookbackMonths);
    return {
      done: true,
      dry_run: true,
      operation_id: operationId,
      calendar_id: null,
      events_read: 0,
      events_stored: 0,
      attendees_seen: 0,
      page_token: null,
      sync_token_preserved: true,
      diagnostics: plan as unknown as Record<string, unknown>,
    };
  }

  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const conn = await ensureDefaultCalendarSelection(admin, connection);
  const listed = await fetchGoogleCalendarList(accessToken);
  const enabled = getEnabledCalendarIds(conn) ?? listed.filter((c) => c.primary).map((c) => c.id);
  const calendarIds = enabled.filter((id) => !isNoiseCalendarId(id));

  if (calendarIds.length === 0) {
    return {
      done: true,
      dry_run: false,
      operation_id: operationId,
      calendar_id: null,
      events_read: 0,
      events_stored: 0,
      attendees_seen: 0,
      page_token: null,
      sync_token_preserved: true,
      diagnostics: { error: "no_calendars" },
    };
  }

  const timeMax = new Date();
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - lookbackMonths);

  // Pick the first incomplete cursor, or create cursors for all calendars
  let { data: cursor } = await admin
    .from("google_calendar_historical_cursors")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("operation_id", operationId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!cursor) {
    const rows = calendarIds.map((calendarId) => ({
      connection_id: connection.id,
      owner_user_id: connection.user_id,
      calendar_id: calendarId,
      operation_id: operationId,
      time_min: timeMin.toISOString(),
      time_max: timeMax.toISOString(),
      status: "pending",
      dry_run: false,
      metadata: { lookback_months: lookbackMonths },
    }));
    await admin.from("google_calendar_historical_cursors").upsert(rows, {
      onConflict: "connection_id,calendar_id,operation_id",
      ignoreDuplicates: true,
    });
    const { data: first } = await admin
      .from("google_calendar_historical_cursors")
      .select("*")
      .eq("connection_id", connection.id)
      .eq("operation_id", operationId)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    cursor = first;
  }

  if (!cursor) {
    return {
      done: true,
      dry_run: false,
      operation_id: operationId,
      calendar_id: null,
      events_read: 0,
      events_stored: 0,
      attendees_seen: 0,
      page_token: null,
      sync_token_preserved: true,
      diagnostics: { message: "all_calendars_complete" },
    };
  }

  await admin.from("google_calendar_historical_cursors").update({
    status: "running",
    started_at: cursor.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", cursor.id);

  // Verify incremental sync_token still present (must not clear)
  const { data: syncState } = await admin
    .from("google_sync_states")
    .select("id, sync_token")
    .eq("connection_id", connection.id)
    .eq("source", "calendar")
    .eq("resource_key", cursor.calendar_id)
    .maybeSingle();
  const syncTokenBefore = syncState?.sync_token ?? null;

  let eventsUrl =
    `/calendar/v3/calendars/${encodeURIComponent(cursor.calendar_id)}/events` +
    `?singleEvents=true&maxResults=${BATCH_EVENTS}` +
    `&timeMin=${encodeURIComponent(cursor.time_min)}` +
    `&timeMax=${encodeURIComponent(cursor.time_max)}` +
    `&orderBy=startTime`;
  if (cursor.page_token) eventsUrl += `&pageToken=${encodeURIComponent(cursor.page_token)}`;

  const resp = await googleApiFetch(accessToken, eventsUrl);
  const text = await resp.text();
  if (!resp.ok) {
    await admin.from("google_calendar_historical_cursors").update({
      status: "failed",
      last_error: text.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", cursor.id);
    throw new Error(`Historical calendar recovery failed: ${text.slice(0, 400)}`);
  }

  const payload = JSON.parse(text) as {
    items?: Array<Record<string, unknown>>;
    nextPageToken?: string;
  };

  let eventsStored = 0;
  let attendeesSeen = 0;
  const exclusionCounts: Record<string, number> = {};

  for (const event of payload.items ?? []) {
    const eventId = String(event.id ?? "");
    if (!eventId) continue;
    const status = String(event.status ?? "confirmed");
    const start = (event.start as { dateTime?: string; date?: string }) ?? {};
    const eventDate = eventDateFromGoogleStart(start);
    const occurredAt = start.dateTime ?? (start.date ? `${start.date}T00:00:00Z` : new Date().toISOString());
    const attendeesRaw = ((event.attendees as Array<{
      email?: string;
      displayName?: string;
      resource?: boolean;
      self?: boolean;
      responseStatus?: string;
    }>) ?? []);
    const attendees = attendeesRaw
      .map((a) => normalizeEmail(a.email))
      .filter(Boolean) as string[];
    const organizer = (event.organizer as { email?: string })?.email ?? null;

    for (const email of attendees) {
      attendeesSeen++;
      if (isInternalOxusEmail(email)) exclusionCounts.internal_oxus = (exclusionCounts.internal_oxus ?? 0) + 1;
      else if (isAutomatedSender(email)) exclusionCounts.automated = (exclusionCounts.automated ?? 0) + 1;
    }

    if (status === "cancelled") {
      await admin.from("calendar_events").update({ cancelled_at: new Date().toISOString() })
        .eq("connection_id", connection.id)
        .eq("external_calendar_id", cursor.calendar_id)
        .eq("external_id", eventId);
      await admin.from("google_calendar_attendees").update({ cancelled_at: new Date().toISOString() })
        .eq("connection_id", connection.id)
        .eq("external_calendar_id", cursor.calendar_id)
        .eq("external_event_id", eventId);
      continue;
    }

    // Partial unique index (provider='google') is not usable via PostgREST onConflict —
    // use explicit lookup + insert/update so historical recovery actually persists rows.
    const eventPayload = {
      title: String(event.summary ?? "Untitled meeting"),
      event_date: eventDate,
      start_time: start.dateTime ? start.dateTime.slice(11, 16) : null,
      end_time: (event.end as { dateTime?: string })?.dateTime?.slice(11, 16) ?? null,
      type: "meeting",
      location: String(event.location ?? "") || null,
      provider: "google",
      external_id: eventId,
      external_calendar_id: cursor.calendar_id,
      connection_id: connection.id,
      owner_user_id: connection.user_id,
      organizer_email: organizer,
      attendee_emails: attendees,
      meeting_url: (event.hangoutLink as string) ?? null,
      html_link: (event.htmlLink as string) ?? null,
      metadata: { calendar_id: cursor.calendar_id, historical_recovery: true, operation_id: operationId },
    };

    const { data: existingEvent } = await admin
      .from("calendar_events")
      .select("id")
      .eq("connection_id", connection.id)
      .eq("external_calendar_id", cursor.calendar_id)
      .eq("external_id", eventId)
      .maybeSingle();

    let calRow: { id: string } | null = existingEvent;
    if (existingEvent?.id) {
      const { error: updErr } = await admin.from("calendar_events").update(eventPayload).eq("id", existingEvent.id);
      if (updErr) {
        console.error("[calendar-historical-recovery] calendar_events update failed", updErr.message);
      } else {
        eventsStored++;
      }
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("calendar_events")
        .insert(eventPayload)
        .select("id")
        .single();
      if (insErr) {
        console.error("[calendar-historical-recovery] calendar_events insert failed", insErr.message);
      } else {
        calRow = inserted;
        eventsStored++;
      }
    }

    const interactionExternalId = `${cursor.calendar_id}:${eventId}`;
    const interactionPayload = {
      connection_id: connection.id,
      owner_user_id: connection.user_id,
      interaction_type: "calendar_event",
      external_id: interactionExternalId,
      occurred_at: occurredAt,
      subject: String(event.summary ?? ""),
      organizer_email: organizer,
      attendee_emails: attendees,
      participant_emails: attendees,
      snippet: String(event.description ?? "").slice(0, 500) || null,
      metadata: { calendar_id: cursor.calendar_id, event_id: eventId, historical_recovery: true },
    };
    const { data: existingInteraction } = await admin
      .from("google_interactions")
      .select("id")
      .eq("connection_id", connection.id)
      .eq("interaction_type", "calendar_event")
      .eq("external_id", interactionExternalId)
      .maybeSingle();
    if (existingInteraction?.id) {
      await admin.from("google_interactions").update(interactionPayload).eq("id", existingInteraction.id);
    } else {
      await admin.from("google_interactions").insert(interactionPayload);
    }

    if (usesCrmResolverV2(connection)) {
      await ingestCalendarAttendees(admin, connection, {
        calendarEventId: calRow?.id ?? null,
        externalEventId: eventId,
        externalCalendarId: cursor.calendar_id,
        eventStartAt: occurredAt,
        eventStatus: status,
        attendees: attendeesRaw,
      });
    }
  }

  const nextPage = payload.nextPageToken ?? null;
  const eventsRead = (cursor.events_read ?? 0) + (payload.items?.length ?? 0);
  const eventsStoredTotal = (cursor.events_stored ?? 0) + eventsStored;
  const attendeesTotal = (cursor.attendees_seen ?? 0) + attendeesSeen;

  if (nextPage) {
    await admin.from("google_calendar_historical_cursors").update({
      page_token: nextPage,
      events_read: eventsRead,
      events_stored: eventsStoredTotal,
      attendees_seen: attendeesTotal,
      metadata: { ...(cursor.metadata as Record<string, unknown> ?? {}), exclusion_counts: exclusionCounts },
      updated_at: new Date().toISOString(),
    }).eq("id", cursor.id);
  } else {
    await admin.from("google_calendar_historical_cursors").update({
      page_token: null,
      status: "completed",
      completed_at: new Date().toISOString(),
      events_read: eventsRead,
      events_stored: eventsStoredTotal,
      attendees_seen: attendeesTotal,
      metadata: { ...(cursor.metadata as Record<string, unknown> ?? {}), exclusion_counts: exclusionCounts },
      updated_at: new Date().toISOString(),
    }).eq("id", cursor.id);
  }

  // Assert sync token untouched
  const { data: syncAfter } = await admin
    .from("google_sync_states")
    .select("sync_token")
    .eq("connection_id", connection.id)
    .eq("source", "calendar")
    .eq("resource_key", cursor.calendar_id)
    .maybeSingle();

  const { count: remaining } = await admin
    .from("google_calendar_historical_cursors")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .eq("operation_id", operationId)
    .in("status", ["pending", "running"]);

  return {
    done: (remaining ?? 0) === 0 && !nextPage,
    dry_run: false,
    operation_id: operationId,
    calendar_id: cursor.calendar_id,
    events_read: eventsRead,
    events_stored: eventsStoredTotal,
    attendees_seen: attendeesTotal,
    page_token: nextPage,
    sync_token_preserved: (syncAfter?.sync_token ?? null) === syncTokenBefore,
    diagnostics: {
      connection_id: connection.id,
      provider_account_id: connection.google_account_id,
      calendar_id: cursor.calendar_id,
      operation_id: operationId,
      exclusion_counts: exclusionCounts,
      batch_events: payload.items?.length ?? 0,
    },
  };
}
