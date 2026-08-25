/**
 * Lightweight calendar-only incremental sync for page freshness.
 * Does not touch Gmail, Contacts, CRM resolution, AI, or Firecrawl.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getValidGoogleAccessToken,
  googleApiFetch,
  type GoogleConnectionRow,
} from "./google-auth.ts";
import {
  ensureDefaultCalendarSelection,
  getEnabledCalendarIds,
  fetchGoogleCalendarList,
  defaultSelectedCalendars,
} from "./googleCalendarHelpers.ts";
import { eventDateFromGoogleStart } from "./crmGoogleEntityProcessing.ts";
import { upsertSyncState } from "./googleSyncState.ts";
import { touchSyncLease, releaseSyncLease, calendarLeaseKey } from "./googleSyncLease.ts";

const MAX_CALENDARS_PER_RUN = 6;
const MAX_EVENTS_PER_CALENDAR = 250;

export type CalendarFreshnessCounters = {
  google_api_calls: number;
  events_scanned: number;
  events_stored: number;
  events_cancelled: number;
  calendars_synced: number;
  ai_calls: number;
  firecrawl_calls: number;
  gmail_calls: number;
  duration_ms: number;
};

function emptyCounters(): CalendarFreshnessCounters {
  return {
    google_api_calls: 0,
    events_scanned: 0,
    events_stored: 0,
    events_cancelled: 0,
    calendars_synced: 0,
    ai_calls: 0,
    firecrawl_calls: 0,
    gmail_calls: 0,
    duration_ms: 0,
  };
}

async function resolveCalendarIds(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
): Promise<string[]> {
  const conn = await ensureDefaultCalendarSelection(admin, connection);
  const enabled = getEnabledCalendarIds(conn);
  if (enabled?.length) return enabled.slice(0, MAX_CALENDARS_PER_RUN);

  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const calList = await fetchGoogleCalendarList(accessToken);
  return defaultSelectedCalendars(calList)
    .filter((c) => c.enabled !== false)
    .map((c) => c.id)
    .slice(0, MAX_CALENDARS_PER_RUN);
}

async function syncOneCalendar(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  accessToken: string,
  calendarId: string,
  counters: CalendarFreshnessCounters,
): Promise<void> {
  const { data: syncState } = await admin
    .from("google_sync_states")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("source", "calendar")
    .eq("resource_key", calendarId)
    .maybeSingle();

  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - 30);
  const timeMax = new Date();
  timeMax.setMonth(timeMax.getMonth() + 6);

  let eventsUrl: string;
  if (syncState?.sync_token && syncState.initial_sync_completed) {
    eventsUrl = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?syncToken=${encodeURIComponent(syncState.sync_token)}`;
  } else {
    eventsUrl = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&maxResults=100&timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}&orderBy=startTime`;
  }

  let pageToken: string | undefined;
  let eventsProcessed = 0;

  do {
    counters.google_api_calls += 1;
    const url = pageToken ? `${eventsUrl}&pageToken=${encodeURIComponent(pageToken)}` : eventsUrl;
    const resp = await googleApiFetch(accessToken, url);
    const text = await resp.text();

    if (!resp.ok) {
      if (resp.status === 410 && syncState?.sync_token) {
        await admin.from("google_sync_states").update({ sync_token: null }).eq("id", syncState.id);
        return syncOneCalendar(admin, connection, accessToken, calendarId, counters);
      }
      throw new Error(`Calendar sync failed (${resp.status}): ${text.slice(0, 300)}`);
    }

    const payload = JSON.parse(text) as {
      items?: Array<Record<string, unknown>>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const event of payload.items ?? []) {
      if (eventsProcessed >= MAX_EVENTS_PER_CALENDAR) break;
      counters.events_scanned += 1;
      eventsProcessed += 1;

      const eventId = String(event.id ?? "");
      if (!eventId) continue;
      const status = String(event.status ?? "confirmed");
      const start = (event.start as { dateTime?: string; date?: string }) ?? {};
      const eventDate = eventDateFromGoogleStart(start);
      const attendeesRaw = ((event.attendees as Array<{ email?: string }>) ?? []);
      const attendees = attendeesRaw.map((a) => (a.email ?? "").toLowerCase()).filter(Boolean);
      const organizer = (event.organizer as { email?: string })?.email ?? null;

      if (status === "cancelled") {
        counters.events_cancelled += 1;
        await admin.from("calendar_events")
          .delete()
          .eq("connection_id", connection.id)
          .eq("external_calendar_id", calendarId)
          .eq("external_id", eventId);
        continue;
      }

      const { error: calError } = await admin.from("calendar_events").upsert(
        {
          title: String(event.summary ?? "Untitled meeting"),
          event_date: eventDate,
          start_time: start.dateTime ? start.dateTime.slice(11, 16) : null,
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
          metadata: { calendar_id: calendarId },
        },
        { onConflict: "connection_id,external_calendar_id,external_id", ignoreDuplicates: false },
      );
      if (!calError) counters.events_stored += 1;
    }

    pageToken = eventsProcessed >= MAX_EVENTS_PER_CALENDAR ? undefined : payload.nextPageToken;

    if (!pageToken && payload.nextSyncToken) {
      await upsertSyncState(admin, connection, "calendar", calendarId, {
        sync_token: payload.nextSyncToken,
        initial_sync_completed: true,
        last_attempted_sync_at: new Date().toISOString(),
        last_successful_sync_at: new Date().toISOString(),
        last_error: null,
        next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
    }
  } while (pageToken);

  counters.calendars_synced += 1;
}

export async function runCalendarFreshnessSync(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
  options?: { lease_key?: string; trigger_run_id?: string },
): Promise<CalendarFreshnessCounters> {
  const started = Date.now();
  const counters = emptyCounters();
  const leaseKey = options?.lease_key ?? calendarLeaseKey(connection.id);

  try {
    const accessToken = await getValidGoogleAccessToken(admin, connection);
    const calendarIds = await resolveCalendarIds(admin, connection);

    for (const calendarId of calendarIds) {
      await syncOneCalendar(admin, connection, accessToken, calendarId, counters);
      await touchSyncLease(admin, leaseKey, counters);
    }

    const now = new Date().toISOString();
    await admin.from("user_google_connections").update({
      calendar_last_synced_at: now,
      last_successful_sync_at: now,
      last_sync_error: null,
    }).eq("id", connection.id);

    counters.duration_ms = Date.now() - started;
    await releaseSyncLease(admin, leaseKey, { status: "completed", counters });
    return counters;
  } catch (e) {
    counters.duration_ms = Date.now() - started;
    const message = e instanceof Error ? e.message : "Calendar freshness sync failed";
    await releaseSyncLease(admin, leaseKey, { status: "failed", counters, error: message });
    throw e;
  }
}
