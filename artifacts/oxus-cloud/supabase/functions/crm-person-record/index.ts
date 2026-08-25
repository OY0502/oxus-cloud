import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import {
  assertAllowedConfirmedUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  acceptPersonNameSuggestion,
  changePrimaryCompany,
  createPersonNote,
  deleteCrmPerson,
  getPersonActivities,
  getPersonDetail,
  getPersonSources,
  isCrmAdmin,
  mergeCrmPeople,
  restorePersonRecord,
  setPersonInactive,
  suppressPersonRecord,
  updatePersonRecord,
} from "../_shared/crmPersonRecord.ts";

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
    const auth = await assertAllowedConfirmedUser(req);
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const admin = getServiceRoleSupabase();
    const personId = String(body.person_id ?? "");

    switch (action) {
      case "get_detail":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await getPersonDetail(admin, personId));

      case "get_activities": {
        if (!personId) return json({ error: "person_id is required." }, 400);
        const result = await getPersonActivities(admin, personId, {
          limit: Number(body.limit ?? 20),
          offset: Number(body.offset ?? 0),
          filter: String(body.filter ?? "all") as "all",
        });
        return json(result);
      }

      case "get_sources":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await getPersonSources(admin, personId));

      case "update_person":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await updatePersonRecord(
          admin,
          personId,
          auth.userId,
          auth.role,
          (body.fields ?? {}) as Record<string, unknown>,
          { unlock_fields: body.unlock_fields as string[] | undefined },
        ));

      case "accept_name_suggestion":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await acceptPersonNameSuggestion(
          admin,
          personId,
          auth.userId,
          auth.role,
          String(body.suggested_name ?? ""),
        ));

      case "create_note":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await createPersonNote(admin, personId, auth.userId, auth.role, {
          body: String(body.body ?? ""),
          company_id: body.company_id as string | null | undefined,
          project_id: body.project_id as string | null | undefined,
        }));

      case "suppress_person":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await suppressPersonRecord(admin, personId, auth.userId, auth.role));

      case "restore_person":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await restorePersonRecord(admin, personId, auth.userId, auth.role));

      case "set_inactive":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await setPersonInactive(admin, personId, auth.userId, auth.role, body.inactive !== false));

      case "change_primary_company":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await changePrimaryCompany(
          admin,
          personId,
          String(body.company_id ?? ""),
          auth.userId,
          auth.role,
        ));

      case "merge_person":
        if (!isCrmAdmin(auth.role)) return json({ error: "Only admins can merge records." }, 403);
        await mergeCrmPeople(admin, String(body.surviving_id ?? ""), String(body.merged_id ?? ""), auth.userId);
        return json({ success: true });

      case "delete_person":
        if (!isCrmAdmin(auth.role)) return json({ error: "Only admins can delete records." }, 403);
        return json(await deleteCrmPerson(
          admin,
          personId,
          auth.userId,
          { permanent: body.permanent === true },
        ));

      case "unlock_field":
        if (!personId) return json({ error: "person_id is required." }, 400);
        return json(await updatePersonRecord(
          admin,
          personId,
          auth.userId,
          auth.role,
          {},
          { unlock_fields: [String(body.field ?? "")] },
        ));

      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[crm-person-record]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
