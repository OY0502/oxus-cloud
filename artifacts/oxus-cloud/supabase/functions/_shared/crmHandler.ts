import { assertSuperAdminUser, internalOxusAuthErrorResponse, InternalOxusAuthError } from "../_shared/internalOxusAuth.ts";
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function crmHandler(
  handler: (admin: ReturnType<typeof getServiceRoleSupabase>, userId: string, body: Record<string, unknown>) => Promise<unknown>,
) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    try {
      const auth = await assertSuperAdminUser(req);
      const body = await req.json() as Record<string, unknown>;
      const admin = getServiceRoleSupabase();
      const result = await handler(admin, auth.userId, body);
      return json(result);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      console.error("[crm]", (e as Error).message);
      return json({ error: (e as Error).message }, 500);
    }
  };
}

export default crmHandler;
