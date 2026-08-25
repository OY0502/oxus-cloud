import crmHandler from "../_shared/crmHandler.ts";
import { deleteCrmCompany, deleteCrmPerson, mergeCrmCompanies, mergeCrmPeople } from "../_shared/crmOperations.ts";
import { canOverwriteField } from "../_shared/crmEntityResolution.ts";

Deno.serve(crmHandler(async (admin, userId, body) => {
  const action = String(body.action ?? "");

  if (action === "delete_company") {
    return deleteCrmCompany(admin, String(body.company_id), userId);
  }
  if (action === "delete_person") {
    return deleteCrmPerson(admin, String(body.person_id), userId);
  }
  if (action === "merge_company") {
    await mergeCrmCompanies(admin, String(body.surviving_id), String(body.merged_id), userId);
    return { success: true };
  }
  if (action === "merge_person") {
    await mergeCrmPeople(admin, String(body.surviving_id), String(body.merged_id), userId);
    return { success: true };
  }
  if (action === "update_company") {
    const companyId = String(body.company_id ?? "");
    const fields = (body.fields ?? {}) as Record<string, unknown>;
    const lockedFields = Array.isArray(body.locked_fields) ? body.locked_fields as string[] : [];
    const { data: existing } = await admin.from("clients").select("field_provenance, locked_fields").eq("id", companyId).single();
    const provenance = (existing?.field_provenance ?? {}) as Record<string, { source: string; updated_at: string }>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(fields)) {
      if (canOverwriteField(existing?.locked_fields ?? lockedFields, key, provenance, "manual")) {
        patch[key] = value;
        provenance[key] = { source: "manual", updated_at: new Date().toISOString() };
      }
    }
    patch.field_provenance = provenance;
    if (lockedFields.length) patch.locked_fields = lockedFields;
    const { data, error } = await admin.from("clients").update(patch).eq("id", companyId).select("*").single();
    if (error) throw new Error(error.message);
    return { company: data };
  }
  if (action === "update_person") {
    const personId = String(body.person_id ?? "");
    const fields = (body.fields ?? {}) as Record<string, unknown>;
    const lockedFields = Array.isArray(body.locked_fields) ? body.locked_fields as string[] : [];
    const { data: existing } = await admin.from("contacts").select("field_provenance, locked_fields").eq("id", personId).single();
    const provenance = (existing?.field_provenance ?? {}) as Record<string, { source: string; updated_at: string }>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(fields)) {
      if (canOverwriteField(existing?.locked_fields ?? lockedFields, key, provenance, "manual")) {
        patch[key] = value;
        provenance[key] = { source: "manual", updated_at: new Date().toISOString() };
      }
    }
    patch.field_provenance = provenance;
    if (lockedFields.length) patch.locked_fields = lockedFields;
    const { data, error } = await admin.from("contacts").update(patch).eq("id", personId).select("*").single();
    if (error) throw new Error(error.message);
    return { person: data };
  }

  throw new Error("Unknown action.");
}));
