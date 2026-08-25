import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  enrichPayableWithAllocations,
  logPayableActivity,
} from "../_shared/teamMemberPayables.ts";

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
    const auth = await assertSuperAdminUser(req);
    const body = await req.json() as {
      payable_id?: string;
      action?: "approve" | "release" | "cancel";
      notes?: string | null;
    };

    const payableId = body.payable_id;
    const action = body.action;
    if (!payableId || !action) return json({ error: "payable_id and action are required." }, 400);

    const admin = getServiceRoleSupabase();
    const { data: existing, error: fetchErr } = await admin
      .from("team_member_payables")
      .select("*")
      .eq("id", payableId)
      .maybeSingle();
    if (fetchErr || !existing) return json({ error: "Payable not found." }, 404);

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { updated_at: now };

    if (action === "approve") {
      if (existing.approval_status === "cancelled") {
        return json({ error: "Cannot approve a cancelled payable." }, 400);
      }
      update.approval_status = "approved";
      update.approved_by = auth.userId;
      update.approved_at = now;
      if (existing.release_condition === "immediate" && !existing.released_at) {
        update.released_at = now;
      }
    } else if (action === "release") {
      if (existing.approval_status !== "approved") {
        return json({ error: "Payable must be approved before release." }, 400);
      }
      update.released_at = now;
      update.needs_review = false;
    } else if (action === "cancel") {
      update.approval_status = "cancelled";
    } else {
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    if (body.notes) update.notes = body.notes;

    const { data, error } = await admin
      .from("team_member_payables")
      .update(update)
      .eq("id", payableId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    const titles: Record<string, string> = {
      approve: "Payable approved",
      release: "Payable released",
      cancel: "Payable cancelled",
    };

    await logPayableActivity(admin, {
      title: titles[action],
      entityId: data.id,
      personId: data.person_id,
      createdBy: auth.userId,
      metadata: {
        previous_status: existing.approval_status,
        resulting_status: data.approval_status,
        released_at: data.released_at,
      },
    });

    const [enriched] = await enrichPayableWithAllocations(admin, [data]);
    return json({ payable: enriched });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[change-team-member-payable-state]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
