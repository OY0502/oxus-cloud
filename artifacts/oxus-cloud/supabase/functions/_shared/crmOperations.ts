import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createSuppression, recordEntitySource } from "./crmEntityResolution.ts";
import { normalizeDomain, normalizeEmail } from "./google-auth.ts";
import { triggerDevTask, shouldQueueTriggerDevTasks } from "./agent/triggerDev.ts";
import { normalizeWebsiteUrl } from "./projectWebsiteEnrichment.ts";
import {
  publishPersonFromReview,
  type ReviewActionResult,
} from "./crmPersonPublication.ts";

export type AcceptCrmCandidateResult = ReviewActionResult & {
  entity_id: string;
  entity_type: string;
};

export async function acceptCrmCandidate(
  admin: SupabaseClient,
  candidateId: string,
  userId: string,
  overrides?: Record<string, unknown>,
): Promise<AcceptCrmCandidateResult> {
  const { data: candidate, error } = await admin
    .from("crm_entity_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  if (error || !candidate) throw new Error("Candidate not found.");

  // Idempotent retry after successful commit
  if (candidate.status === "accepted" && candidate.created_entity_id) {
    return {
      success: true,
      entity_id: candidate.created_entity_id,
      entity_type: candidate.entity_type,
      decision: candidate.entity_type === "person" ? "matched_existing_person" : "added_as_person",
      created: false,
      matched: true,
      display_name: candidate.display_name,
      visibility: "active",
      company_id: candidate.matched_company_id,
      company_name: candidate.company_name,
      warning: null,
    };
  }
  if (candidate.status !== "pending") throw new Error("Candidate already processed.");

  const patch = { ...(overrides ?? {}) };

  if (candidate.entity_type === "company") {
    // Confirm existing matched company instead of inserting a duplicate.
    if (candidate.matched_company_id) {
      const confirmPatch: Record<string, unknown> = {
        data_quality_status: "accepted",
        visibility_state: "active",
        needs_review: false,
        quality_reason: null,
        updated_at: new Date().toISOString(),
      };
      const nextType = patch.company_type ?? candidate.suggested_company_type;
      if (nextType && nextType !== "client") confirmPatch.company_type = String(nextType);
      const { error: updateErr } = await admin.from("clients").update(confirmPatch).eq("id", candidate.matched_company_id);
      if (updateErr) throw new Error(updateErr.message);
      const { error: candErr } = await admin.from("crm_entity_candidates").update({
        status: "accepted",
        created_entity_id: candidate.matched_company_id,
        processed_at: new Date().toISOString(),
        processed_by: userId,
      }).eq("id", candidateId);
      if (candErr) throw new Error(candErr.message);
      return {
        success: true,
        entity_id: candidate.matched_company_id,
        entity_type: "company",
        decision: "matched_existing_person",
        created: false,
        matched: true,
        display_name: candidate.display_name,
        visibility: "active",
        company_id: candidate.matched_company_id,
        company_name: candidate.display_name,
        warning: null,
      };
    }

    const name = String(patch.name ?? candidate.display_name ?? candidate.company_name ?? "Unknown company");
    const website = normalizeWebsiteUrl(String(patch.website ?? candidate.website ?? ""));
    const domain = normalizeDomain(String(patch.domain ?? candidate.domain ?? website ?? ""));

    const { data: company, error: insertErr } = await admin.from("clients").insert({
      name,
      website,
      primary_domain: domain,
      company_type: String(patch.company_type ?? candidate.suggested_company_type ?? "prospect"),
      description: patch.description as string | null ?? null,
      source: "Google",
      relationship_owner_id: userId,
      data_quality_status: "accepted",
      visibility_state: "active",
      needs_review: false,
      metadata: { accepted_from_candidate: candidateId },
    }).select("id").single();
    if (insertErr) throw new Error(insertErr.message);

    await recordEntitySource(admin, "company", company!.id, "google", candidate.id, candidate.confidence);
    const { error: candErr } = await admin.from("crm_entity_candidates").update({
      status: "accepted",
      created_entity_id: company!.id,
      processed_at: new Date().toISOString(),
      processed_by: userId,
    }).eq("id", candidateId);
    if (candErr) throw new Error(candErr.message);

    if (website && shouldQueueTriggerDevTasks()) {
      await triggerDevTask("crm-enrich-company", { company_id: company!.id, user_id: userId, website }, {
        idempotencyKey: `crm-enrich:${company!.id}`,
      });
    }

    return {
      success: true,
      entity_id: company!.id,
      entity_type: "company",
      decision: "added_as_person",
      created: true,
      matched: false,
      display_name: name,
      visibility: "active",
      company_id: company!.id,
      company_name: name,
      warning: null,
    };
  }

  if (candidate.entity_type === "person") {
    const published = await publishPersonFromReview(admin, {
      userId,
      reviewIdentity: `candidate:${candidateId}`,
      candidateId,
      email: candidate.email,
      displayName: candidate.display_name,
      jobTitle: candidate.job_title,
      companyName: candidate.company_name,
      companyId: candidate.matched_company_id,
      relationshipType: candidate.suggested_relationship_type,
      matchedPersonId: candidate.matched_person_id,
      confidence: Number(candidate.confidence ?? 0),
      sources: Array.isArray(candidate.sources) ? candidate.sources.map(String) : [],
      evidenceId: candidate.id,
      overrides: patch,
      previousStatus: candidate.status,
    });

    const { error: candErr } = await admin.from("crm_entity_candidates").update({
      status: "accepted",
      created_entity_id: published.entity_id,
      matched_person_id: candidate.matched_person_id ?? published.entity_id,
      processed_at: new Date().toISOString(),
      processed_by: userId,
      metadata: {
        ...(typeof candidate.metadata === "object" && candidate.metadata ? candidate.metadata : {}),
        accept_decision: published.decision,
        accept_created: published.created,
      },
    }).eq("id", candidateId).eq("status", "pending");
    if (candErr) throw new Error(candErr.message);

    return {
      success: true,
      entity_id: published.entity_id,
      entity_type: "person",
      decision: published.decision,
      created: published.created,
      matched: published.matched,
      display_name: published.display_name,
      visibility: published.visibility,
      company_id: published.company_id,
      company_name: published.company_name,
      warning: published.warning,
    };
  }

  if (candidate.entity_type === "lead") {
    const { data: quote, error: insertErr } = await admin.from("quotes").insert({
      title: String(patch.title ?? candidate.display_name ?? "New lead"),
      stage: "new-lead",
      organization_id: candidate.matched_company_id,
      point_of_contact_id: candidate.matched_person_id,
      request_message: candidate.reason,
      source: "Google",
      metadata: { accepted_from_candidate: candidateId, evidence: candidate.evidence },
    }).select("id").single();
    if (insertErr) throw new Error(insertErr.message);

    const { error: candErr } = await admin.from("crm_entity_candidates").update({
      status: "accepted",
      created_entity_id: quote!.id,
      processed_at: new Date().toISOString(),
      processed_by: userId,
    }).eq("id", candidateId);
    if (candErr) throw new Error(candErr.message);

    return {
      success: true,
      entity_id: quote!.id,
      entity_type: "lead",
      decision: "added_as_person",
      created: true,
      matched: false,
      display_name: candidate.display_name,
      visibility: null,
      company_id: candidate.matched_company_id,
      company_name: candidate.company_name,
      warning: null,
    };
  }

  throw new Error("Unsupported candidate type.");
}

export async function ignoreCrmCandidate(
  admin: SupabaseClient,
  candidateId: string,
  userId: string,
): Promise<void> {
  const { data: candidate } = await admin.from("crm_entity_candidates").select("*").eq("id", candidateId).maybeSingle();
  if (!candidate) throw new Error("Candidate not found.");

  await admin.from("crm_entity_candidates").update({
    status: "ignored",
    processed_at: new Date().toISOString(),
    processed_by: userId,
  }).eq("id", candidateId);

  if (candidate.email) {
    await createSuppression(admin, {
      suppression_type: "email",
      suppression_key: normalizeEmail(candidate.email)!,
      owner_user_id: userId,
      entity_type: candidate.entity_type,
      reason: "ignored_candidate",
      created_by: userId,
    });
  }
  if (candidate.domain) {
    await createSuppression(admin, {
      suppression_type: "domain",
      suppression_key: normalizeDomain(candidate.domain)!,
      owner_user_id: userId,
      entity_type: "company",
      reason: "ignored_candidate",
      created_by: userId,
    });
  }
}

export async function deleteCrmPerson(
  admin: SupabaseClient,
  personId: string,
  userId: string,
  options?: { permanent?: boolean },
): Promise<{ action: string }> {
  const { data: person } = await admin.from("contacts").select("*").eq("id", personId).maybeSingle();
  if (!person) throw new Error("Person not found.");

  const [{ count: projectCount }, { count: invoiceCount }] = await Promise.all([
    admin.from("project_contact_assignees").select("*", { count: "exact", head: true }).eq("contact_id", personId),
    admin.from("contractor_invoices").select("*", { count: "exact", head: true }).eq("person_id", personId),
  ]);

  if ((projectCount ?? 0) > 0 || (invoiceCount ?? 0) > 0) {
    await admin.from("contacts").update({ person_status: "inactive", archived_at: new Date().toISOString() }).eq("id", personId);
    if (person.email) {
      await createSuppression(admin, {
        suppression_type: "email",
        suppression_key: normalizeEmail(person.email)!,
        owner_user_id: userId,
        entity_type: "person",
        entity_id: personId,
        reason: "archived_with_dependencies",
        created_by: userId,
      });
    }
    return { action: "archived" };
  }

  if (person.email) {
    await createSuppression(admin, {
      suppression_type: "email",
      suppression_key: normalizeEmail(person.email)!,
      owner_user_id: userId,
      entity_type: "person",
      entity_id: personId,
      reason: "deleted",
      created_by: userId,
    });
  }

  const { data: mappings } = await admin.from("person_provider_mappings").select("external_id").eq("person_id", personId);
  for (const m of mappings ?? []) {
    await createSuppression(admin, {
      suppression_type: "google_people_resource",
      suppression_key: m.external_id,
      owner_user_id: userId,
      entity_type: "person",
      reason: "deleted",
      created_by: userId,
    });
  }

  await admin.from("contacts").delete().eq("id", personId);
  return { action: "deleted" };
}

export async function deleteCrmCompany(
  admin: SupabaseClient,
  companyId: string,
  userId: string,
): Promise<{ action: string }> {
  const { data: company } = await admin.from("clients").select("*").eq("id", companyId).maybeSingle();
  if (!company) throw new Error("Company not found.");

  const { count: projectCount } = await admin.from("projects").select("*", { count: "exact", head: true }).eq("organization_id", companyId);
  const { count: invoiceCount } = await admin.from("invoices").select("*", { count: "exact", head: true }).eq("client_id", companyId);

  if ((projectCount ?? 0) > 0 || (invoiceCount ?? 0) > 0) {
    await admin.from("clients").update({ status: "inactive", archived_at: new Date().toISOString() }).eq("id", companyId);
    if (company.primary_domain) {
      await createSuppression(admin, {
        suppression_type: "domain",
        suppression_key: company.primary_domain,
        owner_user_id: userId,
        entity_type: "company",
        entity_id: companyId,
        reason: "archived_with_dependencies",
        created_by: userId,
      });
    }
    return { action: "archived" };
  }

  const domain = company.primary_domain ?? normalizeDomain(company.website);
  if (domain) {
    await createSuppression(admin, {
      suppression_type: "domain",
      suppression_key: domain,
      owner_user_id: userId,
      entity_type: "company",
      entity_id: companyId,
      reason: "deleted",
      created_by: userId,
    });
  }

  await admin.from("clients").delete().eq("id", companyId);
  return { action: "deleted" };
}

export async function mergeCrmCompanies(
  admin: SupabaseClient,
  survivingId: string,
  mergedId: string,
  userId: string,
): Promise<void> {
  if (survivingId === mergedId) throw new Error("Cannot merge company with itself.");

  const { data: merged } = await admin.from("clients").select("*").eq("id", mergedId).single();
  if (!merged) throw new Error("Merged company not found.");

  await admin.from("company_people").update({ company_id: survivingId }).eq("company_id", mergedId);
  await admin.from("projects").update({ organization_id: survivingId, client_id: survivingId }).eq("organization_id", mergedId);
  await admin.from("quotes").update({ organization_id: survivingId }).eq("organization_id", mergedId);
  await admin.from("invoices").update({ client_id: survivingId }).eq("client_id", mergedId);
  await admin.from("contacts").update({ client_id: survivingId }).eq("client_id", mergedId);
  await admin.from("activities").update({ company_id: survivingId }).eq("company_id", mergedId);
  await admin.from("google_interactions").update({ company_id: survivingId }).eq("company_id", mergedId);
  await admin.from("calendar_events").update({ client_id: survivingId }).eq("client_id", mergedId);
  await admin.from("company_provider_mappings").update({ company_id: survivingId }).eq("company_id", mergedId);

  await admin.from("crm_merge_history").insert({
    entity_type: "company",
    surviving_id: survivingId,
    merged_id: mergedId,
    merged_snapshot: merged,
    merged_by: userId,
  });

  await admin.from("clients").delete().eq("id", mergedId);
}

export async function mergeCrmPeople(
  admin: SupabaseClient,
  survivingId: string,
  mergedId: string,
  userId: string,
): Promise<void> {
  if (survivingId === mergedId) throw new Error("Cannot merge person with themselves.");

  const { data: surviving } = await admin.from("contacts").select("*").eq("id", survivingId).single();
  const { data: merged } = await admin.from("contacts").select("*").eq("id", mergedId).single();
  if (!surviving || !merged) throw new Error("Person not found.");

  const alternateEmails = [...new Set([
    ...(surviving.alternate_emails ?? []),
    ...(merged.alternate_emails ?? []),
    merged.email,
  ].filter(Boolean).map((e) => normalizeEmail(String(e))).filter(Boolean) as string[])];

  await admin.from("contacts").update({ alternate_emails: alternateEmails }).eq("id", survivingId);
  await admin.from("company_people").update({ person_id: survivingId }).eq("person_id", mergedId);
  await admin.from("project_contact_assignees").update({ contact_id: survivingId }).eq("contact_id", mergedId);
  await admin.from("quotes").update({ point_of_contact_id: survivingId }).eq("point_of_contact_id", mergedId);
  await admin.from("projects").update({ point_of_contact_id: survivingId }).eq("point_of_contact_id", mergedId);
  await admin.from("activities").update({ contact_id: survivingId }).eq("contact_id", mergedId);
  await admin.from("person_provider_mappings").update({ person_id: survivingId }).eq("person_id", mergedId);

  await admin.from("crm_merge_history").insert({
    entity_type: "person",
    surviving_id: survivingId,
    merged_id: mergedId,
    merged_snapshot: merged,
    merged_by: userId,
  });

  await admin.from("contacts").delete().eq("id", mergedId);
}
