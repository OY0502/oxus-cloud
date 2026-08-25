import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { assertInternalOxusAuthUser, InternalOxusAuthError, internalOxusAuthErrorResponse } from "../_shared/internalOxusAuth.ts";
import { cancelGoogleImportRun } from "../_shared/googleImportReconcile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

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

    const body = await req.json() as { import_run_id?: string };
    if (!body.import_run_id) return err("import_run_id is required.", 400, "INVALID_INPUT");

    const admin = getServiceRoleSupabase();
    const { data: run } = await admin
      .from("google_import_runs")
      .select("id, owner_user_id")
      .eq("id", body.import_run_id)
      .maybeSingle();
    if (!run || run.owner_user_id !== userId) return err("Import run not found.", 404, "NOT_FOUND");

    const cancelled = await cancelGoogleImportRun(admin, body.import_run_id);
    if (!cancelled) return err("Import is not active.", 409, "IMPORT_NOT_ACTIVE");

    return json({ success: true, import_run_id: body.import_run_id, status: "cancelled" });
  } catch (e) {
    console.error("[google-cancel-import]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR");
  }
});
