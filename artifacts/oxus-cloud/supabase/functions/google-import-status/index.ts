import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
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

    let importRunId: string | undefined;
    if (req.method === "POST") {
      const body = await req.json() as { import_run_id?: string };
      importRunId = body.import_run_id;
    } else {
      importRunId = new URL(req.url).searchParams.get("import_run_id") ?? undefined;
    }

    const admin = getServiceRoleSupabase();
    let query = admin.from("google_import_runs").select("*").eq("owner_user_id", userId).order("created_at", { ascending: false }).limit(10);
    if (importRunId) query = admin.from("google_import_runs").select("*").eq("id", importRunId).eq("owner_user_id", userId);
    const { data, error } = await query;
    if (error) return err(error.message, 500, "DB_ERROR");

    return json({ runs: importRunId ? (data?.[0] ? [data[0]] : []) : data ?? [] });
  } catch (e) {
    return err((e as Error).message, 500, "UNEXPECTED_ERROR");
  }
});
