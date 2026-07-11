import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type TeamMemberDependencySummary = {
  project_assignments: number;
  payouts: number;
  payout_total: number;
  contractor_invoices: number;
  rate_records: number;
  company_relationships: number;
  activities: number;
  deals: number;
  has_workspace_access: boolean;
  auth_user_id: string | null;
};

export type TeamMemberDeleteAssessment = {
  can_delete: boolean;
  blockers: string[];
  summary: TeamMemberDependencySummary;
  will_delete: string[];
  will_preserve: string[];
};

export async function loadTeamMember(
  admin: SupabaseClient,
  personId: string,
): Promise<{
  id: string;
  name: string;
  email: string | null;
  employment_type: string | null;
  type: string;
  person_status: string;
  profile_id: string | null;
  availability: string | null;
} | null> {
  const { data, error } = await admin
    .from("contacts")
    .select("id, name, email, employment_type, type, person_status, profile_id, availability")
    .eq("id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function assessTeamMemberDeletion(
  admin: SupabaseClient,
  person: { id: string; name: string; email: string | null; profile_id: string | null },
): Promise<TeamMemberDeleteAssessment> {
  const personId = person.id;
  const email = person.email?.trim().toLowerCase() ?? null;

  const [
    assignmentsRes,
    payoutsRes,
    invoicesRes,
    ratesRes,
    companyRes,
    activitiesRes,
    dealsRes,
    profileByIdRes,
    profileByEmailRes,
  ] = await Promise.all([
    admin.from("project_contact_assignees").select("id", { count: "exact", head: true }).eq("contact_id", personId),
    admin.from("payouts").select("amount").eq("person_id", personId),
    admin.from("contractor_invoices").select("id", { count: "exact", head: true }).eq("person_id", personId),
    admin.from("team_member_rates").select("id", { count: "exact", head: true }).eq("person_id", personId),
    admin.from("company_people").select("id", { count: "exact", head: true }).eq("person_id", personId),
    admin.from("activities").select("id", { count: "exact", head: true }).eq("contact_id", personId),
    admin.from("deals").select("id", { count: "exact", head: true }).eq("contact_id", personId),
    person.profile_id
      ? admin.from("profiles").select("id").eq("id", person.profile_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    email
      ? admin.from("profiles").select("id").ilike("email", email).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (assignmentsRes.error) throw new Error(assignmentsRes.error.message);
  if (payoutsRes.error) throw new Error(payoutsRes.error.message);
  if (invoicesRes.error) throw new Error(invoicesRes.error.message);
  if (ratesRes.error) throw new Error(ratesRes.error.message);
  if (companyRes.error) throw new Error(companyRes.error.message);
  if (activitiesRes.error) throw new Error(activitiesRes.error.message);
  if (dealsRes.error) throw new Error(dealsRes.error.message);

  const payouts = payoutsRes.data ?? [];
  const payoutTotal = payouts.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const authUserId =
    (profileByIdRes.data as { id: string } | null)?.id ??
    (profileByEmailRes.data as { id: string } | null)?.id ??
    null;

  const summary: TeamMemberDependencySummary = {
    project_assignments: assignmentsRes.count ?? 0,
    payouts: payouts.length,
    payout_total: payoutTotal,
    contractor_invoices: invoicesRes.count ?? 0,
    rate_records: ratesRes.count ?? 0,
    company_relationships: companyRes.count ?? 0,
    activities: activitiesRes.count ?? 0,
    deals: dealsRes.count ?? 0,
    has_workspace_access: !!authUserId,
    auth_user_id: authUserId,
  };

  const blockers: string[] = [];
  if (summary.project_assignments > 0) {
    blockers.push(
      `${summary.project_assignments} project assignment${summary.project_assignments === 1 ? "" : "s"} (project history must be preserved)`,
    );
  }
  if (summary.payouts > 0) {
    blockers.push(
      `${summary.payouts} payout record${summary.payouts === 1 ? "" : "s"} (${summary.payout_total.toFixed(2)} total)`,
    );
  }
  if (summary.contractor_invoices > 0) {
    blockers.push(
      `${summary.contractor_invoices} contractor invoice${summary.contractor_invoices === 1 ? "" : "s"}`,
    );
  }
  if (summary.deals > 0) {
    blockers.push(`${summary.deals} CRM deal${summary.deals === 1 ? "" : "s"} linked to this person`);
  }

  const will_delete = [
    "Team roster relationship (company link)",
    "Person record in People",
  ];
  if (summary.rate_records > 0) will_delete.push(`${summary.rate_records} rate record(s)`);

  const will_preserve: string[] = [];
  if (summary.activities > 0) {
    will_preserve.push(`${summary.activities} activity log entries (contact reference cleared)`);
  }
  if (summary.project_assignments > 0) {
    will_preserve.push("Project assignment history (blocks deletion)");
  }
  if (summary.payouts > 0) will_preserve.push("Payment and payout history (blocks deletion)");
  if (summary.contractor_invoices > 0) {
    will_preserve.push("Contractor invoice records (blocks deletion)");
  }
  if (summary.deals > 0) will_preserve.push("CRM deal links (blocks deletion)");
  if (blockers.length > 0) {
    will_preserve.push("Deactivate instead to remove from the active roster without losing history");
  }

  return {
    can_delete: blockers.length === 0,
    blockers,
    summary,
    will_delete,
    will_preserve,
  };
}

export async function assertNotLastSuperAdmin(
  admin: SupabaseClient,
  authUserId: string | null,
): Promise<void> {
  if (!authUserId) return;

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", authUserId)
    .maybeSingle();
  if (profileErr) throw new Error(profileErr.message);
  if (profile?.role !== "super_admin") return;

  const { count, error: countErr } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("access_status", "active");
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) <= 1) {
    throw new Error("Cannot delete the last active super admin.");
  }
}

export async function logTeamMemberActivity(
  admin: SupabaseClient,
  input: {
    contactId: string;
    title: string;
    description?: string | null;
    createdBy: string;
    kind?: string;
  },
): Promise<void> {
  const payload = {
    kind: input.kind ?? "info",
    title: input.title,
    description: input.description ?? null,
    entity_type: "team_member",
    entity_id: input.contactId,
    contact_id: input.contactId,
    created_by: input.createdBy,
    visibility: "team",
  };
  let { error } = await admin.from("activities").insert(payload);
  if (error?.message?.includes("visibility")) {
    ({ error } = await admin.from("activities").insert({
      kind: payload.kind,
      title: payload.title,
      description: payload.description,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      contact_id: payload.contact_id,
      created_by: payload.created_by,
    }));
  }
  if (error) throw new Error(error.message);
}
