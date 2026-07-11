import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const ALLOWED_FIELDS = new Set([
  "name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "location",
  "job_title",
  "employment_type",
  "person_status",
  "availability",
  "stack",
  "notes",
  "metadata",
]);

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
    const body = await req.json() as { person_id?: string; patch?: Record<string, unknown> };
    const personId = body.person_id;
    if (!personId) return json({ error: "person_id is required." }, 400);

    const rawPatch = body.patch ?? {};
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawPatch)) {
      if (ALLOWED_FIELDS.has(key)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return json({ error: "No valid fields to update." }, 400);

    if (patch.person_status === "inactive") {
      patch.deactivated_at = new Date().toISOString();
    } else if (patch.person_status === "active") {
      patch.deactivated_at = null;
    }

    const admin = getServiceRoleSupabase();
    const { data: existing, error: fetchErr } = await admin
      .from("contacts")
      .select("id")
      .eq("id", personId)
      .maybeSingle();
    if (fetchErr || !existing) return json({ error: "Team member not found." }, 404);

    const { data, error } = await admin
      .from("contacts")
      .update(patch)
      .eq("id", personId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await admin.from("activities").insert({
      kind: "info",
      title: "Profile updated",
      description: "Team member details saved",
      entity_type: "contact",
      entity_id: personId,
      contact_id: personId,
      visibility: "team",
      created_by: auth.userId,
    });

    return json({ contact: data });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[team-member-update]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
