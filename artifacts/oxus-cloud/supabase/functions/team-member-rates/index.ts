import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { validateCurrency } from "../_shared/teamMemberRates.ts";

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

type Action =
  | "create"
  | "update"
  | "end"
  | "replace"
  | "set_default"
  | "delete"
  | "check_usage"
  | "resolve";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const auth = await assertSuperAdminUser(req);
    const body = await req.json() as Record<string, unknown>;
    const action = body.action as Action;
    // Use the caller's JWT client for RPCs so auth.uid() and is_super_admin() work inside SECURITY DEFINER functions.
    const db = auth.supabase;

    switch (action) {
      case "create": {
        const currency = validateCurrency(String(body.currency ?? "EUR"));
        const { data, error } = await db.rpc("create_team_member_rate", {
          p_person_id: body.person_id,
          p_name: body.name ?? "Rate",
          p_rate_type: body.rate_type,
          p_amount: body.amount,
          p_currency: currency,
          p_project_id: body.project_id ?? null,
          p_work_type: body.work_type ?? null,
          p_is_default: body.is_default ?? false,
          p_effective_from: body.effective_from ?? new Date().toISOString().slice(0, 10),
          p_effective_to: body.effective_to ?? null,
          p_description: body.description ?? null,
          p_notes: body.notes ?? null,
        });
        if (error) throw new Error(error.message);
        return json({ rate: data });
      }

      case "update": {
        if (body.currency) validateCurrency(String(body.currency));
        const { data, error } = await db.rpc("update_team_member_rate", {
          p_rate_id: body.rate_id,
          p_name: body.name ?? null,
          p_description: body.description ?? null,
          p_rate_type: body.rate_type ?? null,
          p_amount: body.amount ?? null,
          p_currency: body.currency ?? null,
          p_project_id: body.project_id ?? null,
          p_work_type: body.work_type ?? null,
          p_is_default: body.is_default ?? null,
          p_effective_from: body.effective_from ?? null,
          p_effective_to: body.effective_to ?? null,
          p_notes: body.notes ?? null,
          p_allow_used: body.allow_used ?? false,
        });
        if (error) throw new Error(error.message);
        return json({ rate: data });
      }

      case "end": {
        const { data, error } = await db.rpc("end_team_member_rate", {
          p_rate_id: body.rate_id,
          p_effective_to: body.effective_to ?? new Date().toISOString().slice(0, 10),
        });
        if (error) throw new Error(error.message);
        return json({ rate: data });
      }

      case "replace": {
        if (body.currency) validateCurrency(String(body.currency));
        const { data, error } = await db.rpc("replace_team_member_rate", {
          p_rate_id: body.rate_id,
          p_new_effective_from: body.effective_from,
          p_name: body.name ?? null,
          p_rate_type: body.rate_type ?? null,
          p_amount: body.amount ?? null,
          p_currency: body.currency ?? null,
          p_description: body.description ?? null,
          p_notes: body.notes ?? null,
        });
        if (error) throw new Error(error.message);
        return json({ rate: data });
      }

      case "set_default": {
        const { data, error } = await db.rpc("set_default_team_member_rate", {
          p_rate_id: body.rate_id,
        });
        if (error) throw new Error(error.message);
        return json({ rate: data });
      }

      case "delete": {
        const { error } = await db.rpc("delete_team_member_rate", {
          p_rate_id: body.rate_id,
        });
        if (error) throw new Error(error.message);
        return json({ deleted: true });
      }

      case "check_usage": {
        const { data, error } = await db.rpc("team_member_rate_is_used", {
          p_rate_id: body.rate_id,
        });
        if (error) throw new Error(error.message);
        return json({ is_used: !!data });
      }

      case "resolve": {
        const personId = body.person_id as string;
        if (!personId) return json({ error: "person_id is required." }, 400);

        const { data: rates, error: ratesErr } = await db
          .from("team_member_rates")
          .select("*")
          .eq("person_id", personId)
          .order("effective_from", { ascending: false });
        if (ratesErr) throw new Error(ratesErr.message);

        const { resolveTeamMemberRate } = await import("../_shared/teamMemberRates.ts");
        const result = resolveTeamMemberRate({
          rates: (rates ?? []) as Parameters<typeof resolveTeamMemberRate>[0]["rates"],
          projectId: (body.project_id as string) ?? null,
          workType: (body.work_type as string) ?? null,
          effectiveDate: (body.effective_date as string) ?? undefined,
        });
        return json(result);
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[team-member-rates]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
