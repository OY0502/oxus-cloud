import { createClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase, normalizeClickupRedirectPath, resolveClickupAppBaseUrl } from "../_shared/clickup-auth.ts";
import {
  assertInternalOxusAuthUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number, code: string, details?: string) {
  if (status >= 500) console.error(`[${code}] ${message}`, details ?? "");
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

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const clientId = Deno.env.get("CLICKUP_OAUTH_CLIENT_ID")?.trim();
    const redirectUri = Deno.env.get("CLICKUP_OAUTH_REDIRECT_URI")?.trim();
    if (!clientId || !redirectUri) {
      const missing = [
        !clientId ? "CLICKUP_OAUTH_CLIENT_ID" : null,
        !redirectUri ? "CLICKUP_OAUTH_REDIRECT_URI" : null,
      ].filter(Boolean).join(", ");
      return err(
        "ClickUp OAuth is not configured on the server.",
        500,
        "CONFIG_ERROR",
        `Missing Supabase secrets: ${missing}. Local .env is not used by deployed Edge Functions — run: npx supabase secrets set ${missing}=...`,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const anonKey = getAnonKey();
    if (!supabaseUrl || !anonKey) return err("Missing Supabase environment.", 500, "CONFIG_ERROR");

    try {
      resolveClickupAppBaseUrl(req);
    } catch (e) {
      return err("ClickUp OAuth app URL is not configured on the server.", 500, "CONFIG_ERROR", (e as Error).message);
    }

    let body: { redirect_after?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth, error: authErr } = await supabase.auth.getUser(token);
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const state = randomState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const redirectAfter = normalizeClickupRedirectPath(
      typeof body.redirect_after === "string" ? body.redirect_after : undefined,
      req,
    );

    const admin = getServiceRoleSupabase();
    const { error: insertErr } = await admin.from("clickup_oauth_states").insert({
      state,
      user_id: userId,
      redirect_after: redirectAfter,
      expires_at: expiresAt,
      status: "pending",
    });
    if (insertErr) return err("Failed to start ClickUp OAuth.", 500, "DB_ERROR", insertErr.message);

    const authUrl = `https://app.clickup.com/api?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    return json({ auth_url: authUrl });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
