/**
 * Canonical CRM review workspace — single definition for KPI + Import Center.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { acceptCrmCandidate, ignoreCrmCandidate } from "./crmOperations.ts";
import { createSuppression } from "./crmEntityResolution.ts";
import { normalizeDomain, normalizeEmail } from "./google-auth.ts";
import {
  classifyReviewCandidateType,
  linkAsCompanyInbox,
  publishPersonFromReview,
  suppressReviewIdentity,
  type CrmReviewAction,
  type ReviewActionResult,
} from "./crmPersonPublication.ts";

export type CrmReviewKind =
  | "new_suggestion"
  | "existing_needs_review"
  | "possible_duplicate"
  | "identity_conflict"
  | "missing_classification";

export type CrmReviewItem = {
  id: string;
  owner_user_id: string;
  connection_id: string | null;
  entity_type: "company" | "person" | "lead";
  status: string;
  display_name: string;
  email: string | null;
  domain: string | null;
  website: string | null;
  job_title: string | null;
  company_name: string | null;
  suggested_company_type: string | null;
  suggested_relationship_type: string | null;
  confidence: number;
  evidence: Record<string, unknown>;
  sources: string[];
  reason: string | null;
  matched_company_id: string | null;
  matched_person_id: string | null;
  created_entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  review_identity: string;
  review_kind: CrmReviewKind;
  review_reason: string;
  /** Action-oriented classification for UI (person_candidate, role_inbox, …). */
  candidate_type: string;
};

export type CrmReviewCounts = {
  people: number;
  companies: number;
  leads: number;
  total: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapRow(row: Record<string, unknown>): CrmReviewItem {
  const entityType = row.entity_type as CrmReviewItem["entity_type"];
  const email = (row.email as string | null) ?? null;
  const reviewKind = (row.review_kind as CrmReviewKind) ?? "new_suggestion";
  const reviewReason = String(row.review_reason ?? row.reason ?? "Needs review");
  const evidence = asRecord(row.evidence);
  const isRoleInbox = evidence.is_role_inbox === true
    || reviewReason.toLowerCase().includes("role inbox");
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    connection_id: (row.connection_id as string | null) ?? null,
    entity_type: entityType,
    status: String(row.status ?? "pending"),
    display_name: String(row.display_name ?? "Unknown"),
    email,
    domain: (row.domain as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    job_title: (row.job_title as string | null) ?? null,
    company_name: (row.company_name as string | null) ?? null,
    suggested_company_type: (row.suggested_company_type as string | null) ?? null,
    suggested_relationship_type: (row.suggested_relationship_type as string | null) ?? null,
    confidence: Number(row.confidence ?? 0),
    evidence,
    sources: Array.isArray(row.sources) ? row.sources.map(String) : [],
    reason: (row.reason as string | null) ?? null,
    matched_company_id: (row.matched_company_id as string | null) ?? null,
    matched_person_id: (row.matched_person_id as string | null) ?? null,
    created_entity_id: (row.created_entity_id as string | null) ?? null,
    metadata: asRecord(row.metadata),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    review_identity: String(row.review_identity ?? `candidate:${row.id}`),
    review_kind: reviewKind,
    review_reason: reviewReason,
    candidate_type: classifyReviewCandidateType({
      entityType,
      email,
      reason: (row.reason as string | null) ?? null,
      reviewReason,
      reviewKind,
      isRoleInbox,
    }),
  };
}

export function countCrmReviewItems(items: CrmReviewItem[]): CrmReviewCounts {
  const people = items.filter((i) => i.entity_type === "person").length;
  const companies = items.filter((i) => i.entity_type === "company").length;
  const leads = items.filter((i) => i.entity_type === "lead").length;
  return { people, companies, leads, total: people + companies + leads };
}

/** List unified review workspace rows (candidates + canonical needing review). */
export async function listCrmReviewWorkspace(
  admin: SupabaseClient,
  opts?: { entity_type?: string; limit?: number },
): Promise<{ candidates: CrmReviewItem[]; counts: CrmReviewCounts }> {
  const limit = Math.min(Math.max(Number(opts?.limit ?? 500), 1), 1000);
  let query = admin
    .from("crm_review_workspace_v")
    .select("*")
    .order("confidence", { ascending: false })
    .limit(limit);
  if (opts?.entity_type) query = query.eq("entity_type", opts.entity_type);

  const { data, error } = await query;
  if (error) {
    // Fallback if view not yet migrated: pending candidates only
    if (error.message.includes("crm_review_workspace_v") || error.code === "42P01") {
      let fallback = admin
        .from("crm_entity_candidates")
        .select("*")
        .eq("status", "pending")
        .order("confidence", { ascending: false })
        .limit(limit);
      if (opts?.entity_type) fallback = fallback.eq("entity_type", opts.entity_type);
      const { data: rows, error: fbErr } = await fallback;
      if (fbErr) throw new Error(fbErr.message);
      const candidates = (rows ?? []).map((r) => mapRow({
        ...r,
        review_identity: `candidate:${r.id}`,
        review_kind: r.matched_person_id || r.matched_company_id ? "existing_needs_review" : "new_suggestion",
        review_reason: r.reason ?? "New Google-derived suggestion",
      }));
      return { candidates, counts: countCrmReviewItems(candidates) };
    }
    throw new Error(error.message);
  }

  const candidates = (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
  return { candidates, counts: countCrmReviewItems(candidates) };
}

async function loadReviewContext(
  admin: SupabaseClient,
  reviewIdentity: string,
): Promise<{
  reviewIdentity: string;
  candidateId: string | null;
  entityType: "person" | "company" | "lead";
  email: string | null;
  domain: string | null;
  displayName: string;
  companyName: string | null;
  matchedPersonId: string | null;
  matchedCompanyId: string | null;
  jobTitle: string | null;
  relationshipType: string | null;
  confidence: number;
  sources: string[];
  reason: string | null;
  reviewKind: string | null;
  previousStatus: string | null;
  isRoleInbox: boolean;
}> {
  if (reviewIdentity.startsWith("candidate:") || !reviewIdentity.includes(":")) {
    const id = reviewIdentity.startsWith("candidate:")
      ? reviewIdentity.slice("candidate:".length)
      : reviewIdentity;
    const { data: candidate, error } = await admin.from("crm_entity_candidates").select("*").eq("id", id).maybeSingle();
    if (error || !candidate) throw new Error("Candidate not found.");
    return {
      reviewIdentity: `candidate:${id}`,
      candidateId: id,
      entityType: candidate.entity_type,
      email: candidate.email,
      domain: candidate.domain,
      displayName: candidate.display_name,
      companyName: candidate.company_name,
      matchedPersonId: candidate.matched_person_id,
      matchedCompanyId: candidate.matched_company_id,
      jobTitle: candidate.job_title,
      relationshipType: candidate.suggested_relationship_type,
      confidence: Number(candidate.confidence ?? 0),
      sources: Array.isArray(candidate.sources) ? candidate.sources.map(String) : [],
      reason: candidate.reason,
      reviewKind: candidate.matched_person_id || candidate.matched_company_id ? "existing_needs_review" : "new_suggestion",
      previousStatus: candidate.status,
      isRoleInbox: String(candidate.reason ?? "").toLowerCase().includes("role inbox"),
    };
  }

  if (reviewIdentity.startsWith("person:")) {
    const personId = reviewIdentity.slice("person:".length);
    const { data: person, error } = await admin
      .from("contacts")
      .select("id, name, display_name, email, job_title, company, client_id, relationship_type, is_role_inbox, quality_reason, visibility_state, data_quality_status, aggregated_sources, source")
      .eq("id", personId)
      .maybeSingle();
    if (error || !person) throw new Error("Person not found.");
    return {
      reviewIdentity,
      candidateId: null,
      entityType: "person",
      email: person.email,
      domain: person.email?.includes("@") ? person.email.split("@")[1] : null,
      displayName: person.display_name ?? person.name,
      companyName: person.company,
      matchedPersonId: person.id,
      matchedCompanyId: person.client_id,
      jobTitle: person.job_title,
      relationshipType: person.relationship_type,
      confidence: 0.7,
      sources: Array.isArray(person.aggregated_sources) ? person.aggregated_sources.map(String) : [person.source ?? "CRM"],
      reason: person.quality_reason,
      reviewKind: "existing_needs_review",
      previousStatus: person.visibility_state ?? person.data_quality_status,
      isRoleInbox: !!person.is_role_inbox,
    };
  }

  if (reviewIdentity.startsWith("company:")) {
    const companyId = reviewIdentity.slice("company:".length);
    const { data: company, error } = await admin
      .from("clients")
      .select("id, name, display_name, primary_domain, registrable_domain, quality_reason, visibility_state, data_quality_status")
      .eq("id", companyId)
      .maybeSingle();
    if (error || !company) throw new Error("Company not found.");
    return {
      reviewIdentity,
      candidateId: null,
      entityType: "company",
      email: null,
      domain: company.registrable_domain ?? company.primary_domain,
      displayName: company.display_name ?? company.name,
      companyName: company.display_name ?? company.name,
      matchedPersonId: null,
      matchedCompanyId: company.id,
      jobTitle: null,
      relationshipType: null,
      confidence: 0.7,
      sources: ["CRM"],
      reason: company.quality_reason,
      reviewKind: "existing_needs_review",
      previousStatus: company.visibility_state ?? company.data_quality_status,
      isRoleInbox: false,
    };
  }

  throw new Error("Unsupported review identity.");
}

export async function acceptCrmReviewItem(
  admin: SupabaseClient,
  userId: string,
  reviewIdentity: string,
  overrides?: Record<string, unknown>,
  action: CrmReviewAction = "add_as_person",
): Promise<ReviewActionResult> {
  const ctx = await loadReviewContext(admin, reviewIdentity);
  const candidateType = classifyReviewCandidateType({
    entityType: ctx.entityType,
    email: ctx.email,
    reason: ctx.reason,
    reviewKind: ctx.reviewKind,
    isRoleInbox: ctx.isRoleInbox,
  });

  // Role inbox / automated defaults: never silently publish as People unless explicit add_as_person.
  if (action === "add_as_person" && (candidateType === "role_inbox" || candidateType === "automated_sender")) {
    // Explicit override still allowed (user chose Add contact), but prefer dedicated actions.
  }

  if (action === "link_company_inbox") {
    const linked = await linkAsCompanyInbox(admin, {
      userId,
      reviewIdentity: ctx.reviewIdentity,
      candidateId: ctx.candidateId,
      email: ctx.email,
      displayName: ctx.displayName,
      domain: ctx.domain,
      companyName: ctx.companyName,
      matchedPersonId: ctx.matchedPersonId,
      matchedCompanyId: ctx.matchedCompanyId,
      previousStatus: ctx.previousStatus,
    });
    if (ctx.candidateId) {
      await admin.from("crm_entity_candidates").update({
        status: "ignored",
        processed_at: new Date().toISOString(),
        processed_by: userId,
        metadata: { decision: "linked_as_company_inbox" },
      }).eq("id", ctx.candidateId).eq("status", "pending");
    }
    return linked;
  }

  if (action === "suppress") {
    const suppressed = await suppressReviewIdentity(admin, {
      userId,
      reviewIdentity: ctx.reviewIdentity,
      candidateId: ctx.candidateId,
      email: ctx.email,
      domain: ctx.domain,
      matchedPersonId: ctx.matchedPersonId,
      matchedCompanyId: ctx.matchedCompanyId,
      entityType: ctx.entityType,
      displayName: ctx.displayName,
      previousStatus: ctx.previousStatus,
    });
    if (ctx.candidateId) {
      await ignoreCrmCandidate(admin, ctx.candidateId, userId);
    } else if (ctx.matchedPersonId) {
      await admin.from("crm_entity_candidates")
        .update({ status: "ignored", processed_at: new Date().toISOString(), processed_by: userId })
        .eq("matched_person_id", ctx.matchedPersonId)
        .eq("status", "pending");
    }
    return suppressed;
  }

  if (action === "ignore") {
    await ignoreCrmReviewItem(admin, userId, reviewIdentity);
    return {
      success: true,
      entity_id: ctx.matchedPersonId ?? ctx.matchedCompanyId,
      entity_type: ctx.entityType === "lead" ? null : ctx.entityType,
      decision: "ignored",
      created: false,
      matched: false,
      display_name: ctx.displayName,
      visibility: "suppressed",
      company_id: ctx.matchedCompanyId,
      company_name: ctx.companyName,
      warning: null,
    };
  }

  // Default: add_as_person (canonical publication)
  if (ctx.reviewIdentity.startsWith("candidate:")) {
    return acceptCrmCandidate(admin, ctx.candidateId!, userId, overrides);
  }

  if (ctx.reviewIdentity.startsWith("person:")) {
    const published = await publishPersonFromReview(admin, {
      userId,
      reviewIdentity: ctx.reviewIdentity,
      candidateId: ctx.candidateId,
      email: ctx.email,
      displayName: ctx.displayName,
      jobTitle: ctx.jobTitle,
      companyName: ctx.companyName,
      companyId: ctx.matchedCompanyId,
      relationshipType: ctx.relationshipType,
      matchedPersonId: ctx.matchedPersonId,
      confidence: ctx.confidence,
      sources: ctx.sources,
      overrides,
      previousStatus: ctx.previousStatus,
    });
    await admin.from("crm_entity_candidates")
      .update({
        status: "accepted",
        created_entity_id: published.entity_id,
        processed_at: new Date().toISOString(),
        processed_by: userId,
      })
      .eq("matched_person_id", published.entity_id)
      .eq("status", "pending");
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

  if (ctx.reviewIdentity.startsWith("company:")) {
    const companyId = ctx.matchedCompanyId!;
    const patch: Record<string, unknown> = {
      data_quality_status: "accepted",
      visibility_state: "active",
      needs_review: false,
      quality_reason: null,
      updated_at: new Date().toISOString(),
      ...overrides,
    };
    const { error } = await admin.from("clients").update(patch).eq("id", companyId);
    if (error) throw new Error(error.message);
    await admin.from("crm_entity_candidates")
      .update({ status: "accepted", processed_at: new Date().toISOString(), processed_by: userId })
      .eq("matched_company_id", companyId)
      .eq("status", "pending");
    return {
      success: true,
      entity_id: companyId,
      entity_type: "company",
      decision: "matched_existing_person",
      created: false,
      matched: true,
      display_name: ctx.displayName,
      visibility: "active",
      company_id: companyId,
      company_name: ctx.displayName,
      warning: null,
    };
  }

  throw new Error("Unsupported review identity.");
}

export async function ignoreCrmReviewItem(
  admin: SupabaseClient,
  userId: string,
  reviewIdentity: string,
): Promise<void> {
  if (reviewIdentity.startsWith("candidate:") || !reviewIdentity.includes(":")) {
    const id = reviewIdentity.startsWith("candidate:")
      ? reviewIdentity.slice("candidate:".length)
      : reviewIdentity;
    await ignoreCrmCandidate(admin, id, userId);
    return;
  }

  if (reviewIdentity.startsWith("person:")) {
    const personId = reviewIdentity.slice("person:".length);
    const { data: person } = await admin.from("contacts").select("email").eq("id", personId).maybeSingle();
    await admin.from("contacts").update({
      data_quality_status: "ignored",
      visibility_state: "suppressed",
      suppressed_at: new Date().toISOString(),
      quality_reason: "ignored_in_review",
      updated_at: new Date().toISOString(),
    }).eq("id", personId);
    await admin.from("crm_entity_candidates")
      .update({ status: "ignored", processed_at: new Date().toISOString(), processed_by: userId })
      .eq("matched_person_id", personId)
      .eq("status", "pending");
    if (person?.email) {
      await createSuppression(admin, {
        suppression_type: "email",
        suppression_key: normalizeEmail(person.email)!,
        owner_user_id: userId,
        entity_type: "person",
        entity_id: personId,
        reason: "ignored_in_review",
        created_by: userId,
      });
    }
    return;
  }

  if (reviewIdentity.startsWith("company:")) {
    const companyId = reviewIdentity.slice("company:".length);
    const { data: company } = await admin.from("clients")
      .select("primary_domain, registrable_domain")
      .eq("id", companyId)
      .maybeSingle();
    await admin.from("clients").update({
      data_quality_status: "ignored",
      visibility_state: "suppressed",
      needs_review: false,
      suppressed_at: new Date().toISOString(),
      quality_reason: "ignored_in_review",
      updated_at: new Date().toISOString(),
    }).eq("id", companyId);
    await admin.from("crm_entity_candidates")
      .update({ status: "ignored", processed_at: new Date().toISOString(), processed_by: userId })
      .eq("matched_company_id", companyId)
      .eq("status", "pending");
    const domain = company?.registrable_domain ?? company?.primary_domain;
    if (domain) {
      await createSuppression(admin, {
        suppression_type: "domain",
        suppression_key: normalizeDomain(domain)!,
        owner_user_id: userId,
        entity_type: "company",
        entity_id: companyId,
        reason: "ignored_in_review",
        created_by: userId,
      });
    }
  }
}
