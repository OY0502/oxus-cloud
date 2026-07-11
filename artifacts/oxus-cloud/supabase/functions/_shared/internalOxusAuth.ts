import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getServiceRoleSupabase } from "./clickup-auth.ts";
import { getAuthenticatedUser } from "./slack-auth.ts";

export const INTERNAL_EMAIL_DOMAIN = "oxus.agency";

export const INTERNAL_ACCESS_DENIED_MESSAGE =
  "OXUS Cloud is an internal tool. Please use your @oxus.agency email.";

export class InternalOxusAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = "InternalOxusAuthError";
  }
}

export function normalizeAuthEmail(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  return email.trim().toLowerCase();
}

export function parseEmailAllowlistFromEnv(envValue: string | undefined): Set<string> {
  if (!envValue?.trim()) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((entry) => normalizeAuthEmail(entry))
      .filter((entry): entry is string => entry !== null),
  );
}

export function hasInternalOxusDomain(email: string | null | undefined): boolean {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) return false;
  const at = normalized.lastIndexOf("@");
  if (at < 1) return false;
  return normalized.slice(at + 1) === INTERNAL_EMAIL_DOMAIN;
}

export async function isInternalOxusEmailAllowed(
  email: string | null | undefined,
  admin?: SupabaseClient,
): Promise<boolean> {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) return false;
  if (hasInternalOxusDomain(normalized)) return true;

  const envAllowlist = parseEmailAllowlistFromEnv(Deno.env.get("AUTH_EMAIL_ALLOWLIST"));
  if (envAllowlist.has(normalized)) return true;

  const client = admin ?? getServiceRoleSupabase();
  const { data, error } = await client
    .from("internal_auth_email_allowlist")
    .select("email")
    .eq("email", normalized)
    .maybeSingle();
  if (error) {
    console.error("[internalOxusAuth] allowlist lookup failed", error.message);
    return false;
  }
  return !!data;
}

export async function assertInternalOxusEmail(email: string | null | undefined): Promise<void> {
  if (!(await isInternalOxusEmailAllowed(email))) {
    throw new InternalOxusAuthError(
      INTERNAL_ACCESS_DENIED_MESSAGE,
      403,
      "INTERNAL_ACCESS_DENIED",
    );
  }
}

export async function assertInternalOxusUserId(
  userId: string,
  admin?: SupabaseClient,
): Promise<void> {
  const client = admin ?? getServiceRoleSupabase();
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new InternalOxusAuthError("Authentication required.", 401, "AUTH_REQUIRED");
  }
  await assertInternalOxusEmail(data.user.email);
  await assertConfirmedActiveProfile(userId, data.user.email_confirmed_at, client);
}

export async function assertInternalOxusAuthUser(
  user: { id: string; email?: string | null } | null | undefined,
): Promise<string> {
  if (!user?.id) {
    throw new InternalOxusAuthError("Authentication required.", 401, "AUTH_REQUIRED");
  }
  await assertInternalOxusEmail(user.email);

  const admin = getServiceRoleSupabase();
  const { data, error } = await admin.auth.admin.getUserById(user.id);
  if (error || !data.user) {
    throw new InternalOxusAuthError("Authentication required.", 401, "AUTH_REQUIRED");
  }

  await assertConfirmedActiveProfile(user.id, data.user.email_confirmed_at, admin);
  return user.id;
}

async function assertConfirmedActiveProfile(
  userId: string,
  emailConfirmedAt: string | null | undefined,
  admin: SupabaseClient,
): Promise<void> {
  if (!emailConfirmedAt) {
    throw new InternalOxusAuthError(
      "Please confirm your email before accessing OXUS Cloud.",
      403,
      "EMAIL_NOT_CONFIRMED",
    );
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("access_status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    console.error("[internalOxusAuth] profile lookup failed", profileError.message);
    throw new InternalOxusAuthError("Authentication required.", 401, "AUTH_REQUIRED");
  }

  if (!profile) {
    throw new InternalOxusAuthError(
      INTERNAL_ACCESS_DENIED_MESSAGE,
      403,
      "INTERNAL_ACCESS_DENIED",
    );
  }

  if (profile.access_status === "blocked") {
    throw new InternalOxusAuthError(
      "Your account access has been deactivated.",
      403,
      "PROFILE_INACTIVE",
    );
  }

  if (profile.access_status === "pending") {
    throw new InternalOxusAuthError(
      "Please confirm your email before accessing OXUS Cloud.",
      403,
      "EMAIL_NOT_CONFIRMED",
    );
  }
}

export async function assertInternalOxusUser(
  req: Request,
): Promise<{ supabase: SupabaseClient; userId: string; email: string }> {
  return assertAllowedConfirmedUser(req);
}

export type AllowedOxusUser = {
  supabase: SupabaseClient;
  userId: string;
  email: string;
  role: string | null;
};

export async function assertAllowedConfirmedUser(
  req: Request,
): Promise<AllowedOxusUser> {
  const auth = await getAuthenticatedUser(req.headers.get("Authorization"));
  if (!auth) {
    throw new InternalOxusAuthError("Authentication required.", 401, "AUTH_REQUIRED");
  }

  const { data, error } = await auth.supabase.auth.getUser();
  if (error || !data.user) {
    throw new InternalOxusAuthError("Authentication required.", 401, "AUTH_REQUIRED");
  }

  const email = data.user.email ?? null;
  await assertInternalOxusEmail(email);

  if (!data.user.email_confirmed_at) {
    throw new InternalOxusAuthError(
      "Please confirm your email before accessing OXUS Cloud.",
      403,
      "EMAIL_NOT_CONFIRMED",
    );
  }

  const admin = getServiceRoleSupabase();
  await assertConfirmedActiveProfile(auth.userId, data.user.email_confirmed_at, admin);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", auth.userId)
    .maybeSingle();

  if (profileError) {
    console.error("[internalOxusAuth] profile lookup failed", profileError.message);
    throw new InternalOxusAuthError("Authentication required.", 401, "AUTH_REQUIRED");
  }

  return {
    supabase: auth.supabase,
    userId: auth.userId,
    email: email!,
    role: profile?.role ?? null,
  };
}

export async function assertSuperAdminUser(req: Request): Promise<AllowedOxusUser> {
  const auth = await assertAllowedConfirmedUser(req);
  if (auth.role !== "super_admin") {
    throw new InternalOxusAuthError(
      "You do not have permission to perform this action.",
      403,
      "FORBIDDEN_ROLE",
    );
  }
  return auth;
}

export function internalOxusAuthErrorResponse(
  error: InternalOxusAuthError,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: error.message, code: error.code }),
    {
      status: error.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
