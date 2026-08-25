import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import { resolveCompanyLogo } from "../_shared/resolveCompanyLogo.ts";
import { assertSuperAdminUser, internalOxusAuthErrorResponse, InternalOxusAuthError } from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    await assertSuperAdminUser(req);
    const body = await req.json() as { company_id: string; domain?: string; website_url?: string; force_refresh?: boolean };
    const admin = getServiceRoleSupabase();
    const result = await resolveCompanyLogo(admin, {
      companyId: body.company_id,
      domain: body.domain ?? "",
      websiteUrl: body.website_url,
      forceRefresh: body.force_refresh,
    });

    if (result.logo_url) {
      await admin.from("clients").update({
        logo_url: result.logo_url,
        logo_storage_path: result.logo_storage_path,
        logo_source: result.logo_source,
        logo_source_url: result.logo_source_url,
        logo_confidence: result.logo_confidence,
        logo_status: result.status,
        logo_resolved_at: new Date().toISOString(),
      }).eq("id", body.company_id);
    } else {
      await admin.from("clients").update({
        logo_status: result.status,
        logo_resolved_at: new Date().toISOString(),
      }).eq("id", body.company_id);
    }

    return json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[resolve-company-logo]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
