import { createClient } from "npm:@supabase/supabase-js@2";

function extractCredential(req: Request): string | null {
  const auth = req.headers.get("Authorization")?.trim() ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const apikey = req.headers.get("apikey")?.trim();
  return apikey || null;
}

function serviceRoleEnvKeys(): string[] {
  const keys = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("SUPABASE_SECRET_KEY"),
  ];
  return keys.map((k) => k?.trim()).filter((k): k is string => !!k);
}

/** Fast path: incoming credential matches a known service-role env var. */
export function bearerMatchesServiceRoleEnv(req: Request): boolean {
  const credential = extractCredential(req);
  if (!credential) return false;
  return serviceRoleEnvKeys().some((key) => key === credential);
}

/**
 * Accept Trigger.dev / internal worker calls authenticated with the project service role.
 * String compare first; if that fails (e.g. key format drift), probe auth.admin access.
 */
export async function isServiceRoleRequest(req: Request): Promise<boolean> {
  if (bearerMatchesServiceRoleEnv(req)) return true;

  const credential = extractCredential(req);
  if (!credential) return false;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  if (!supabaseUrl) return false;

  const probe = createClient(supabaseUrl, credential, { auth: { persistSession: false } });
  const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}
