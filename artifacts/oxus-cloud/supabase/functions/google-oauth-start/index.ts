import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BASELINE_SCOPES,
  buildGoogleAuthUrl,
  defaultImportSettings,
  defaultSourcesEnabled,
  getServiceRoleSupabase,
  GOOGLE_SCOPES,
  normalizeGoogleRedirectPath,
  resolveGoogleAppBaseUrl,
} from "../_shared/google-auth.ts";
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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    if (!Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")?.trim() || !Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")?.trim()) {
      return err("Google OAuth is not configured on the server.", 500, "CONFIG_ERROR");
    }

    try {
      resolveGoogleAppBaseUrl(req);
    } catch (e) {
      return err("Google OAuth app URL is not configured.", 500, "CONFIG_ERROR", (e as Error).message);
    }

    let body: { redirect_after?: string; enable_gmail?: boolean; incremental_gmail?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // empty ok
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const anonKey = getAnonKey();
    if (!supabaseUrl || !anonKey) return err("Missing Supabase environment.", 500, "CONFIG_ERROR");

    const supabase = createClient(supabaseUrl, anonKey, {
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
    const { data: existingConnection } = await admin
      .from("user_google_connections")
      .select("granted_scopes, sources_enabled")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    const existingScopes = (existingConnection?.granted_scopes as string[]) ?? [];
    const wantsGmail = body.enable_gmail || body.incremental_gmail;
    const hasGmail = existingScopes.includes(GOOGLE_SCOPES.gmail);

    const requestedScopes = [
      ...BASELINE_SCOPES,
      GOOGLE_SCOPES.contacts,
      GOOGLE_SCOPES.calendar,
      ...(wantsGmail || hasGmail ? [GOOGLE_SCOPES.gmail] : []),
    ];
    const uniqueScopes = [...new Set(requestedScopes)];
    const incremental = !!existingConnection && body.incremental_gmail && !hasGmail;

    const state = randomState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const redirectAfter = normalizeGoogleRedirectPath(body.redirect_after, req);

    await admin.from("google_oauth_states").insert({
      state,
      user_id: userId,
      redirect_after: redirectAfter,
      requested_scopes: uniqueScopes,
      expires_at: expiresAt,
      status: "pending",
    });

    const authUrl = buildGoogleAuthUrl(state, uniqueScopes, { incremental });
    return json({ auth_url: authUrl, requested_scopes: uniqueScopes, incremental });
  } catch (e) {
    console.error("[google-oauth-start]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
