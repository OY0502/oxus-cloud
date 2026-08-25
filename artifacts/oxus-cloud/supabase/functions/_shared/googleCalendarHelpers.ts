/**
 * Google Calendar list + selection helpers.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getValidGoogleAccessToken, googleApiFetch, type GoogleConnectionRow } from "./google-auth.ts";

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  enabled: boolean;
  event_count?: number;
  last_sync_at?: string | null;
  last_error?: string | null;
};

export type CalendarImportSettings = {
  selected_calendars?: Array<{ id: string; summary?: string; primary?: boolean; enabled?: boolean; access_role?: string }>;
};

export async function fetchGoogleCalendarList(
  accessToken: string,
): Promise<Array<{ id: string; summary: string; primary: boolean; accessRole: string }>> {
  const resp = await googleApiFetch(accessToken, "/calendar/v3/users/me/calendarList");
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Calendar list failed: ${text.slice(0, 400)}`);
  const items = (JSON.parse(text) as {
    items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string }>;
  }).items ?? [];
  return items
    .filter((c) => c.id && !c.id.includes("@group.v.calendar.google.com") && !c.id.includes("#holiday@"))
    .map((c) => ({
      id: c.id!,
      summary: c.summary ?? c.id!,
      primary: !!c.primary,
      accessRole: c.accessRole ?? "reader",
    }));
}

export function defaultSelectedCalendars(
  calendars: Array<{ id: string; summary: string; primary: boolean; accessRole: string }>,
): CalendarImportSettings["selected_calendars"] {
  if (calendars.length === 0) return [];
  const primary = calendars.find((c) => c.primary);
  const writable = calendars.filter((c) =>
    c.accessRole === "owner" || c.accessRole === "writer" || c.accessRole === "reader"
  );
  const pick = primary ?? writable[0] ?? calendars[0]!;
  const enabledIds = new Set<string>([pick.id]);
  for (const cal of writable) {
    if (cal.accessRole === "owner" || cal.primary) enabledIds.add(cal.id);
  }
  return calendars.map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary,
    enabled: enabledIds.has(c.id),
    access_role: c.accessRole,
  }));
}

export function getEnabledCalendarIds(connection: GoogleConnectionRow): string[] | null {
  const settings = connection.import_settings as CalendarImportSettings;
  const selected = settings.selected_calendars;
  if (!selected?.length) return null;
  const enabled = selected.filter((c) => c.enabled !== false).map((c) => c.id);
  return enabled.length > 0 ? enabled : null;
}

export async function ensureDefaultCalendarSelection(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
): Promise<GoogleConnectionRow> {
  const settings = connection.import_settings as CalendarImportSettings;
  if (settings.selected_calendars?.some((c) => c.enabled !== false)) {
    return connection;
  }
  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const calendars = await fetchGoogleCalendarList(accessToken);
  const selected_calendars = defaultSelectedCalendars(calendars);
  const import_settings = { ...settings, selected_calendars };
  await admin.from("user_google_connections").update({ import_settings }).eq("id", connection.id);
  return { ...connection, import_settings };
}

export async function loadCalendarsWithSyncState(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
): Promise<GoogleCalendarListEntry[]> {
  const settings = connection.import_settings as CalendarImportSettings;
  const selected = settings.selected_calendars ?? [];
  const { data: syncStates } = await admin
    .from("google_sync_states")
    .select("resource_key, last_successful_sync_at, last_error, metadata")
    .eq("connection_id", connection.id)
    .eq("source", "calendar");

  const syncByKey = new Map((syncStates ?? []).map((s) => [s.resource_key, s]));

  return selected.map((cal) => {
    const sync = syncByKey.get(cal.id);
    const meta = (sync?.metadata ?? {}) as { event_count?: number };
    return {
      id: cal.id,
      summary: cal.summary ?? cal.id,
      primary: !!cal.primary,
      accessRole: cal.access_role ?? "reader",
      enabled: cal.enabled !== false,
      event_count: meta.event_count,
      last_sync_at: sync?.last_successful_sync_at ?? null,
      last_error: sync?.last_error ?? null,
    };
  });
}
