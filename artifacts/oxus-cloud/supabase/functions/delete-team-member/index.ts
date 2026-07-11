import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  assessTeamMemberDeletion,
  assertNotLastSuperAdmin,
  loadTeamMember,
  logTeamMemberActivity,
} from "../_shared/teamMemberLifecycle.ts";

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

function expectedConfirmation(name: string): string {
  return `DELETE ${name.trim()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const auth = await assertSuperAdminUser(req);
    const body = await req.json() as {
      person_id?: string;
      action?: "check_dependencies" | "delete";
      delete_auth_user?: boolean;
      confirmation_text?: string;
    };

    const personId = body.person_id;
    if (!personId) return json({ error: "person_id is required." }, 400);

    const admin = getServiceRoleSupabase();
    const person = await loadTeamMember(admin, personId);
    if (!person) return json({ error: "Team member not found." }, 404);

    const assessment = await assessTeamMemberDeletion(admin, person);
    const engagement =
      person.employment_type === "employee"
        ? "Employee"
        : person.employment_type === "contractor" || person.type === "contractor"
          ? "Contractor"
          : person.type;

    if (body.action === "check_dependencies" || !body.action) {
      return json({
        person: {
          id: person.id,
          name: person.name,
          email: person.email,
          engagement,
          person_status: person.person_status,
        },
        ...assessment,
      });
    }

    if (body.action !== "delete") {
      return json({ error: "action must be check_dependencies or delete." }, 400);
    }

    const linkedAuthUserId = assessment.summary.auth_user_id;
    if (linkedAuthUserId === auth.userId) {
      return json({ error: "You cannot permanently delete your own account." }, 400);
    }

    const personEmail = person.email?.trim().toLowerCase() ?? null;
    if (personEmail && personEmail === auth.email.trim().toLowerCase()) {
      return json({ error: "You cannot permanently delete your own account." }, 400);
    }

    const confirmation = body.confirmation_text?.trim() ?? "";
    if (confirmation !== expectedConfirmation(person.name)) {
      return json({
        error: `Type "${expectedConfirmation(person.name)}" to confirm permanent deletion.`,
      }, 400);
    }

    if (!assessment.can_delete) {
      return json({
        error: "Permanent deletion is blocked because this person has linked records.",
        blockers: assessment.blockers,
        ...assessment,
      }, 400);
    }

    const authUserId = assessment.summary.auth_user_id;
    if (body.delete_auth_user && authUserId) {
      await assertNotLastSuperAdmin(admin, authUserId);
      if (authUserId === auth.userId) {
        return json({ error: "You cannot delete your own login account." }, 400);
      }
    }

    const actorName = auth.email;
    await logTeamMemberActivity(admin, {
      contactId: personId,
      title: "Member permanently deleted",
      description: `${person.name} removed by ${actorName}`,
      createdBy: auth.userId,
      kind: "warning",
    });

    const { error: deleteErr } = await admin.from("contacts").delete().eq("id", personId);
    if (deleteErr) throw new Error(deleteErr.message);

    if (body.delete_auth_user && authUserId) {
      const { error: authDeleteErr } = await admin.auth.admin.deleteUser(authUserId);
      if (authDeleteErr) {
        console.error("[delete-team-member] auth user delete failed", authDeleteErr.message);
        return json({
          deleted: true,
          auth_user_deleted: false,
          auth_delete_error: authDeleteErr.message,
          message: "Person record deleted, but login account removal failed. Remove the auth user manually.",
        });
      }
    }

    return json({
      deleted: true,
      auth_user_deleted: !!(body.delete_auth_user && authUserId),
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[delete-team-member]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
