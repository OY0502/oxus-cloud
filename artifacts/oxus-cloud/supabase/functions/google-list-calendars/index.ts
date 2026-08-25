import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase, getValidGoogleAccessToken, type GoogleConnectionRow } from "../_shared/google-auth.ts";
import { loadCalendarsWithSyncState } from "../_shared/googleCalendarHelpers.ts";
import {
  assertInternalOxusAuthUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

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
    const { data: connection } = await admin.from("user_google_connections").select("*").eq("user_id", userId).maybeSingle();
    if (!connection || connection.status !== "active") {
      return json({ calendars: [], connected: false });
    }

    await getValidGoogleAccessToken(admin, connection as GoogleConnectionRow);
    const calendars = await loadCalendarsWithSyncState(admin, connection as GoogleConnectionRow);

    return json({ connected: true, calendars });
  } catch (e) {
    return err((e as Error).message, 500, "UNEXPECTED_ERROR");
  }
});
