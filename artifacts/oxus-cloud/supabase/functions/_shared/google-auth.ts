import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptGoogleToken } from "./googleTokenCrypto.ts";

export const GOOGLE_SCOPES = {
  openid: "openid",
  email: "email",
  profile: "profile",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
} as const;

export const BASELINE_SCOPES = [GOOGLE_SCOPES.openid, GOOGLE_SCOPES.email, GOOGLE_SCOPES.profile];

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
]);

export function getGoogleApiBaseUrl(): string {
  return (Deno.env.get("GOOGLE_API_BASE_URL") ?? "https://www.googleapis.com").replace(/\/+$/, "");
}

export function getGooglePeopleApiBaseUrl(): string {
  return (Deno.env.get("GOOGLE_PEOPLE_API_BASE_URL") ?? "https://people.googleapis.com").replace(/\/+$/, "");
}

export function getGoogleOAuthBaseUrl(): string {
  return (Deno.env.get("GOOGLE_OAUTH_BASE_URL") ?? "https://accounts.google.com").replace(/\/+$/, "");
}

export function resolveGoogleAppBaseUrl(request?: Request): string {
  const fromEnv = Deno.env.get("GOOGLE_APP_URL")?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (request) {
    const origin = request.headers.get("origin")?.trim();
    if (origin && (origin.includes("oxus.cloud") || origin.includes("localhost"))) {
      return origin.replace(/\/+$/, "");
    }
  }
  throw new Error("GOOGLE_APP_URL is not configured.");
}

export function normalizeGoogleRedirectPath(path: string | undefined, request?: Request): string {
  const fallback = "/settings/integrations";
  if (!path?.trim()) return fallback;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("://")) return fallback;
  const allowed = ["/crm", "/calendar", "/settings", "/settings/integrations", "/projects"];
  const base = trimmed.split("?")[0];
  if (!allowed.some((p) => base === p || base.startsWith(`${p}/`))) return fallback;
  return trimmed;
}

export function resolveServiceRoleKey(): string | null {
  return (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
    null
  );
}

export function getServiceRoleSupabase(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = resolveServiceRoleKey();
  if (!url || !key) throw new Error("Missing Supabase service role configuration.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function defaultImportSettings() {
  return {
    lookback_months: Number(Deno.env.get("GOOGLE_SYNC_LOOKBACK_MONTHS") ?? 12) || 12,
    auto_create_high_confidence: true,
    uncertain_to_review: true,
    exclude_internal_oxus: true,
    include_gmail_content: false,
    import_contacts: true,
    import_calendar: true,
    import_gmail: false,
    calendar_future_only: false,
  };
}

export function defaultSourcesEnabled() {
  return { contacts: true, calendar: true, gmail: false };
}

export function buildGoogleAuthUrl(state: string, scopes: string[], options?: { incremental?: boolean }): string {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")?.trim();
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")?.trim();
  if (!clientId || !redirectUri) {
    throw new Error("Google OAuth is not configured on the server.");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    access_type: "offline",
    prompt: options?.incremental ? "consent" : "consent",
    include_granted_scopes: "true",
  });
  return `${getGoogleOAuthBaseUrl()}/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleConnectionRow = {
  id: string;
  user_id: string;
  google_account_id: string;
  google_email: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  granted_scopes: string[];
  token_expires_at: string | null;
  status: string;
  sources_enabled: Record<string, boolean>;
  import_settings: Record<string, unknown>;
  crm_resolver_version?: number;
  crm_migrated_at?: string | null;
  crm_migration_run_id?: string | null;
};

export async function getActiveGoogleConnection(
  admin: SupabaseClient,
  userId: string,
): Promise<GoogleConnectionRow | null> {
  const { data } = await admin
    .from("user_google_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return data as GoogleConnectionRow;
}

export class GoogleSyncError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleSyncError";
    this.code = code;
  }
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number; scope?: string }> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) {
    throw new GoogleSyncError("GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth is not configured.");
  }

  const resp = await fetch(`${getGoogleOAuthBaseUrl()}/o/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    const code = resp.status === 401 || resp.status === 400
      ? "GOOGLE_TOKEN_REFRESH_FAILED"
      : "GOOGLE_TOKEN_REFRESH_FAILED";
    throw new GoogleSyncError(code, "Google access token refresh failed.");
  }
  return JSON.parse(text);
}

export async function getValidGoogleAccessToken(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
): Promise<string> {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  const needsRefresh = !expiresAt || expiresAt < Date.now() + 60_000;
  if (!needsRefresh) {
    return decryptGoogleToken(connection.access_token_encrypted);
  }
  if (!connection.refresh_token_encrypted) {
    throw new GoogleSyncError("GOOGLE_REFRESH_TOKEN_MISSING", "Google refresh token missing — reconnect Google.");
  }
  let refreshToken: string;
  try {
    refreshToken = await decryptGoogleToken(connection.refresh_token_encrypted);
  } catch {
    throw new GoogleSyncError("GOOGLE_TOKEN_DECRYPT_FAILED", "Could not decrypt Google credentials.");
  }
  const refreshed = await refreshGoogleAccessToken(refreshToken);
  const { encryptGoogleToken } = await import("./googleTokenCrypto.ts");
  const encryptedAccess = await encryptGoogleToken(refreshed.access_token);
  const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await admin.from("user_google_connections").update({
    access_token_encrypted: encryptedAccess,
    token_expires_at: tokenExpiresAt,
    granted_scopes: refreshed.scope?.split(" ") ?? connection.granted_scopes,
    last_sync_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id);
  return refreshed.access_token;
}

export async function googleApiFetch(
  accessToken: string,
  path: string,
  init?: RequestInit & { baseUrl?: string },
): Promise<Response> {
  const baseUrl = init?.baseUrl ?? getGoogleApiBaseUrl();
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const { baseUrl: _ignored, ...fetchInit } = init ?? {};
  return fetch(url, {
    ...fetchInit,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(fetchInit.headers ?? {}),
    },
  });
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  return email.trim().toLowerCase();
}

export function extractDomainFromEmail(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const at = normalized.lastIndexOf("@");
  if (at < 1) return null;
  return normalized.slice(at + 1);
}

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0];
  value = value.split(":")[0];
  return value || null;
}

export function isFreeEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

export function isAutomatedSender(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return true;
  const local = normalized.split("@")[0] ?? "";
  return (
    local.includes("noreply") ||
    local.includes("no-reply") ||
    local.includes("donotreply") ||
    local.includes("notifications") ||
    local.includes("mailer-daemon") ||
    local.startsWith("bounce") ||
    local.startsWith("postmaster")
  );
}

export function isInternalOxusEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const domain = extractDomainFromEmail(normalized);
  return domain === "oxus.agency";
}
