import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { assertInternalOxusAuthUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";
import {
  bumpConnectionGeneration,
  interruptActiveGoogleImportRuns,
} from "../_shared/googleImportLock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function err(message: string, status: number, code: string, details?: string) {
  return json({ error: message, details, code }, status);
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
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    let body: { confirm?: boolean; remove_interactions?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // ok
    }
    if (!body.confirm) return err("Confirmation required.", 400, "CONFIRM_REQUIRED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const anonKey = getAnonKey();
    const supabase = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth } = await supabase.auth.getUser(token);
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const admin = getServiceRoleSupabase();
    const now = new Date().toISOString();

    const { data: connection } = await admin
      .from("user_google_connections")
      .select("id, status, connection_generation, google_account_id, google_email")
      .eq("user_id", userId)
      .maybeSingle();

    if (!connection) {
      return json({ success: true, already_disconnected: true });
    }

    let interruptedIds: string[] = [];
    if (connection.status === "active" || connection.status === "error") {
      const interrupted = await interruptActiveGoogleImportRuns(admin, connection.id, {
        reasonCode: "GOOGLE_SYNC_INTERRUPTED_BY_RECONNECT",
        reasonMessage: "Google sync interrupted because the connection was disconnected.",
      });
      interruptedIds = interrupted.interrupted_ids;
      await bumpConnectionGeneration(admin, connection.id);
    }

    await admin.from("user_google_connections").update({
      status: "revoked",
      disconnected_at: now,
      updated_at: now,
      last_sync_error: null,
    }).eq("user_id", userId).eq("id", connection.id);

    if (body.remove_interactions) {
      await admin.from("google_interactions").delete().eq("owner_user_id", userId);
    }

    console.info("[google-disconnect]", JSON.stringify({
      event: "google_disconnect",
      user_id: userId,
      connection_id: connection.id,
      google_account_id: connection.google_account_id,
      interrupted_run_count: interruptedIds.length,
      interrupted_run_ids: interruptedIds,
    }));

    return json({
      success: true,
      interrupted_import_run_ids: interruptedIds,
      crm_preserved: true,
      checkpoints_preserved: !body.remove_interactions,
    });
  } catch (e) {
    console.error("[google-disconnect]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
