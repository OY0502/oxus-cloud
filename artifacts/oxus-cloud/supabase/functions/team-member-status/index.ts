import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { loadTeamMember, logTeamMemberActivity } from "../_shared/teamMemberLifecycle.ts";

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

type StatusAction = "deactivate" | "reactivate";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const auth = await assertSuperAdminUser(req);
    const body = await req.json() as { person_id?: string; action?: StatusAction };
    const personId = body.person_id;
    const action = body.action;

    if (!personId) return json({ error: "person_id is required." }, 400);
    if (action !== "deactivate" && action !== "reactivate") {
      return json({ error: "action must be deactivate or reactivate." }, 400);
    }

    const admin = getServiceRoleSupabase();
    const existing = await loadTeamMember(admin, personId);
    if (!existing) return json({ error: "Team member not found." }, 404);

    if (action === "deactivate") {
      if (existing.person_status === "inactive") {
        return json({ error: "Member is already inactive." }, 400);
      }

      const now = new Date().toISOString();
      const { data, error } = await admin
        .from("contacts")
        .update({ person_status: "inactive", deactivated_at: now })
        .eq("id", personId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      await logTeamMemberActivity(admin, {
        contactId: personId,
        title: "Member deactivated",
        description: existing.name,
        createdBy: auth.userId,
      });

      return json({ contact: data, action: "deactivate" });
    }

    if (existing.person_status === "active") {
      return json({ error: "Member is already active." }, 400);
    }

    const patch: Record<string, unknown> = {
      person_status: "active",
      deactivated_at: null,
    };
    if (!existing.availability) {
      patch.availability = "unavailable";
    }

    const { data, error } = await admin
      .from("contacts")
      .update(patch)
      .eq("id", personId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await logTeamMemberActivity(admin, {
      contactId: personId,
      title: "Member reactivated",
      description: existing.name,
      createdBy: auth.userId,
      kind: "success",
    });

    return json({ contact: data, action: "reactivate" });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[team-member-status]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
