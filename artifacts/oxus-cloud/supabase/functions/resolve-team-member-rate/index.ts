import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { resolveTeamMemberRate } from "../_shared/teamMemberRates.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await assertSuperAdminUser(req);
    const body = await req.json() as {
      person_id?: string;
      project_id?: string | null;
      work_type?: string | null;
      effective_date?: string;
    };

    const personId = body.person_id;
    if (!personId) return json({ error: "person_id is required." }, 400);

    const admin = getServiceRoleSupabase();
    const { data: rates, error } = await admin
      .from("team_member_rates")
      .select("*")
      .eq("person_id", personId)
      .order("effective_from", { ascending: false });

    if (error) throw new Error(error.message);

    const result = resolveTeamMemberRate({
      rates: (rates ?? []) as Parameters<typeof resolveTeamMemberRate>[0]["rates"],
      projectId: body.project_id ?? null,
      workType: body.work_type ?? null,
      effectiveDate: body.effective_date,
    });

    return json(result);
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[resolve-team-member-rate]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
