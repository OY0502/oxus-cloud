import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import {
  acquireCalendarSyncLease,
  CALENDAR_FRESHNESS_MS,
  CALENDAR_MANUAL_COOLDOWN_MS,
  getCalendarFreshnessMeta,
} from "../_shared/googleSyncLease.ts";
import { shouldQueueTriggerDevTasks, triggerDevTask } from "../_shared/agent/triggerDev.ts";
import { assertInternalOxusAuthUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function err(message: string, status: number, code: string) {
  return json({ error: message, code }, status);
}

function getAnonKey(): string | null {
  const key = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (key) return key;
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getAnonKey()!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: auth } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const admin = getServiceRoleSupabase();
    const { data: connection } = await admin
      .from("user_google_connections")
      .select("id, status, calendar_last_synced_at, last_successful_sync_at, sources_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (!connection || connection.status !== "active") {
      return json({ connected: false, calendar_last_synced_at: null, is_stale: false, refresh_accepted: false });
    }

    const sources = (connection.sources_enabled ?? {}) as Record<string, boolean>;
    if (sources.calendar === false) {
      return json({ connected: true, calendar_enabled: false, calendar_last_synced_at: null, is_stale: false, refresh_accepted: false });
    }

    const meta = await getCalendarFreshnessMeta(admin, connection.id);

    if (req.method === "GET") {
      return json({
        connected: true,
        calendar_enabled: true,
        calendar_last_synced_at: meta.calendar_last_synced_at,
        is_stale: meta.is_stale,
        freshness_ms: meta.freshness_ms,
        active_refresh: meta.active_lease != null,
        refresh_accepted: false,
      });
    }

    let body: { manual?: boolean; force?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // empty body ok
    }

    const freshnessMs = body.manual ? CALENDAR_MANUAL_COOLDOWN_MS : CALENDAR_FRESHNESS_MS;
    const lease = await acquireCalendarSyncLease(admin, {
      connection_id: connection.id,
      sync_reason: body.manual ? "manual_refresh" : "page_open",
      force: body.force === true,
      freshness_ms: freshnessMs,
    });

    if (!lease.acquired) {
      if (lease.reason === "fresh") {
        return json({
          connected: true,
          calendar_last_synced_at: lease.last_sync_at,
          is_stale: false,
          refresh_accepted: false,
          message: "Calendar is already up to date.",
        });
      }
      return json({
        connected: true,
        calendar_last_synced_at: meta.calendar_last_synced_at,
        is_stale: meta.is_stale,
        refresh_accepted: false,
        already_running: true,
        message: "Calendar refresh already in progress.",
      });
    }

    if (shouldQueueTriggerDevTasks()) {
      const result = await triggerDevTask("google-calendar-freshness-sync", {
        connection_id: connection.id,
        user_id: userId,
        lease_key: lease.lease.lease_key,
        sync_reason: body.manual ? "manual_refresh" : "page_open",
      }, { idempotencyKey: `calendar-freshness:${connection.id}:${lease.lease.acquired_at}` });

      await admin.from("google_sync_leases").update({
        owner: result.id,
        run_id: result.id,
      }).eq("lease_key", lease.lease.lease_key);

      return json({
        connected: true,
        calendar_last_synced_at: meta.calendar_last_synced_at,
        is_stale: true,
        refresh_accepted: true,
        trigger_run_id: result.id,
        lease_key: lease.lease.lease_key,
      });
    }

    const { runCalendarFreshnessSync } = await import("../_shared/googleCalendarFreshnessSync.ts");
    const { data: fullConnection } = await admin.from("user_google_connections").select("*").eq("id", connection.id).single();
    const counters = await runCalendarFreshnessSync(admin, fullConnection!, { lease_key: lease.lease.lease_key });

    return json({
      connected: true,
      calendar_last_synced_at: new Date().toISOString(),
      is_stale: false,
      refresh_accepted: true,
      inline: true,
      counters,
    });
  } catch (e) {
    console.error("[google-calendar-refresh]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR");
  }
});
