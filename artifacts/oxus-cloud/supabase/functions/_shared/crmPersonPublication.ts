/**
 * Canonical Person publication from review / import evidence.
 * All accept paths that create or promote a CRM Person must go through here.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createSuppression, recordEntitySource, resolveCompanyByDomain, resolvePersonByEmail } from "./crmEntityResolution.ts";
import { normalizeDomain, normalizeEmail } from "./google-auth.ts";
import { classifyEmailSender } from "./crm/senderClassification.ts";

export type CrmReviewDecision =
  | "added_as_person"
  | "matched_existing_person"
  | "linked_as_company_inbox"
  | "suppressed"
  | "ignored"
  | "merged"
  | "kept_separate"
  | "resolved_conflict";

export type CrmReviewAction =
  | "add_as_person"
  | "link_company_inbox"
  | "suppress"
  | "ignore";

export type PublishPersonResult = {
  entity_id: string;
  entity_type: "person";
  decision: CrmReviewDecision;
  created: boolean;
  matched: boolean;
  display_name: string;
  visibility: string;
  data_quality_status: string;
  is_role_inbox: boolean;
  company_id: string | null;
  company_name: string | null;
  email: string | null;
  warning: string | null;
};

export type ReviewActionResult = {
  success: true;
  entity_id: string | null;
  entity_type: "person" | "company" | "lead" | null;
  decision: CrmReviewDecision;
  created: boolean;
  matched: boolean;
  display_name: string | null;
  visibility: string | null;
  company_id: string | null;
  company_name: string | null;
  warning: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function recordReviewDecision(
  admin: SupabaseClient,
  args: {
    review_identity: string;
    candidate_id: string | null;
    candidate_type: string;
    decision: CrmReviewDecision;
    canonical_entity_id: string | null;
    canonical_entity_type: string | null;
    decided_by: string;
    reason: string | null;
    operation_identity: string;
    previous_status: string | null;
    resulting_status: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("crm_review_decisions").upsert({
    review_identity: args.review_identity,
    candidate_id: args.candidate_id,
    candidate_type: args.candidate_type,
    decision: args.decision,
    canonical_entity_id: args.canonical_entity_id,
    canonical_entity_type: args.canonical_entity_type,
    decided_by: args.decided_by,
    decided_at: new Date().toISOString(),
    reason: args.reason,
    operation_identity: args.operation_identity,
    previous_status: args.previous_status,
    resulting_status: args.resulting_status,
    metadata: args.metadata ?? {},
  }, { onConflict: "operation_identity" });
  // Table may not exist yet during local/dev cutover — do not fail accept.
  if (error && !error.message.includes("crm_review_decisions") && error.code !== "42P01") {
    console.error("[crmPersonPublication] decision write failed:", error.message);
  }
}

async function loadPersonSnapshot(admin: SupabaseClient, personId: string) {
  const { data, error } = await admin
    .from("contacts")
    .select("id, name, display_name, email, visibility_state, data_quality_status, is_role_inbox, client_id, company")
    .eq("id", personId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function activatePersonAsContact(
  admin: SupabaseClient,
  personId: string,
  overrides?: Record<string, unknown>,
): Promise<void> {
  const patch: Record<string, unknown> = {
    data_quality_status: "accepted",
    visibility_state: "active",
    quality_reason: null,
    is_role_inbox: false,
    role_inbox_label: null,
    manually_confirmed: true,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  // Explicit accept of a person clears role-inbox classification.
  patch.is_role_inbox = false;
  patch.role_inbox_label = null;

  const { error } = await admin.from("contacts").update(patch).eq("id", personId);
  if (error) throw new Error(error.message);
}

/**
 * Publish or match a canonical Person from review evidence.
 * Idempotent: re-accepting returns the same Person.
 */
export async function publishPersonFromReview(
  admin: SupabaseClient,
  args: {
    userId: string;
    reviewIdentity: string;
    candidateId: string | null;
    email: string | null;
    displayName: string;
    jobTitle?: string | null;
    companyName?: string | null;
    companyId?: string | null;
    relationshipType?: string | null;
    matchedPersonId?: string | null;
    confidence?: number;
    sources?: string[];
    evidenceId?: string | null;
    overrides?: Record<string, unknown>;
    operationIdentity?: string;
    previousStatus?: string | null;
  },
): Promise<PublishPersonResult> {
  const operationIdentity = args.operationIdentity
    ?? `accept-person:${args.reviewIdentity}`;
  const email = normalizeEmail(String(args.overrides?.email ?? args.email ?? "")) || null;
  const displayName = String(args.overrides?.name ?? args.displayName ?? email ?? "Unknown");
  let companyId = (args.overrides?.company_id as string | undefined)
    ?? args.companyId
    ?? null;
  const relationshipType = String(
    args.overrides?.relationship_type ?? args.relationshipType ?? "client_contact",
  );

  // Idempotency: prior successful decision for this operation
  const { data: priorDecision } = await admin
    .from("crm_review_decisions")
    .select("canonical_entity_id, decision")
    .eq("operation_identity", operationIdentity)
    .maybeSingle();
  if (priorDecision?.canonical_entity_id) {
    const existing = await loadPersonSnapshot(admin, priorDecision.canonical_entity_id);
    if (existing) {
      return {
        entity_id: existing.id,
        entity_type: "person",
        decision: (priorDecision.decision as CrmReviewDecision) ?? "matched_existing_person",
        created: false,
        matched: true,
        display_name: existing.display_name ?? existing.name,
        visibility: existing.visibility_state ?? "active",
        data_quality_status: existing.data_quality_status ?? "accepted",
        is_role_inbox: !!existing.is_role_inbox,
        company_id: existing.client_id,
        company_name: existing.company,
        email: existing.email,
        warning: null,
      };
    }
  }

  // Resolve existing person: matched id → email identity
  let personId = args.matchedPersonId ?? null;
  let created = false;
  let matched = false;

  if (personId) {
    const snap = await loadPersonSnapshot(admin, personId);
    if (!snap) personId = null;
  }

  if (!personId && email) {
    const byEmail = await resolvePersonByEmail(admin, email);
    if (byEmail?.person_id) {
      personId = byEmail.person_id;
      matched = true;
    }
  }

  if (!companyId && args.companyName) {
    const { data: existingCompany } = await admin
      .from("clients")
      .select("id")
      .ilike("name", args.companyName)
      .maybeSingle();
    companyId = existingCompany?.id ?? null;
  }

  if (!companyId && email) {
    const domain = email.split("@")[1] ?? null;
    if (domain) {
      const companyMatch = await resolveCompanyByDomain(admin, domain);
      companyId = companyMatch?.company_id ?? null;
    }
  }

  if (personId) {
    matched = true;
    await activatePersonAsContact(admin, personId, {
      ...(args.overrides ?? {}),
      ...(companyId ? { client_id: companyId } : {}),
      ...(args.companyName ? { company: args.companyName } : {}),
      ...(args.jobTitle || args.overrides?.job_title
        ? { job_title: String(args.overrides?.job_title ?? args.jobTitle) }
        : {}),
    });
  } else {
    const { data: person, error: insertErr } = await admin.from("contacts").insert({
      name: displayName,
      display_name: displayName,
      first_name: displayName.split(" ")[0],
      last_name: displayName.split(" ").slice(1).join(" ") || null,
      email,
      type: "client",
      company: args.companyName ?? null,
      client_id: companyId,
      job_title: String(args.overrides?.job_title ?? args.jobTitle ?? "") || null,
      source: "Google",
      relationship_type: relationshipType,
      relationship_owner_id: args.userId,
      data_quality_status: "accepted",
      visibility_state: "active",
      is_role_inbox: false,
      role_inbox_label: null,
      manually_confirmed: true,
      quality_reason: null,
      metadata: {
        accepted_from_review: args.reviewIdentity,
        accepted_from_candidate: args.candidateId,
      },
      ...(asRecord(args.overrides)),
    }).select("id").single();
    if (insertErr) {
      // Race: unique email — resolve and activate
      if (email && (insertErr.message.includes("duplicate") || insertErr.code === "23505")) {
        const again = await resolvePersonByEmail(admin, email);
        if (again?.person_id) {
          personId = again.person_id;
          matched = true;
          await activatePersonAsContact(admin, personId);
        } else {
          throw new Error(insertErr.message);
        }
      } else {
        throw new Error(insertErr.message);
      }
    } else {
      personId = person!.id;
      created = true;
    }
  }

  if (!personId) throw new Error("Failed to resolve or create Person.");

  if (companyId) {
    await admin.from("company_people").upsert({
      company_id: companyId,
      person_id: personId,
      relationship_type: relationshipType,
      is_primary: false,
    }, { onConflict: "company_id,person_id,relationship_type" });
  }

  if (args.evidenceId || args.candidateId) {
    await recordEntitySource(
      admin,
      "person",
      personId,
      "google",
      args.evidenceId ?? args.candidateId!,
      args.confidence ?? 0.8,
    );
  }

  const decision: CrmReviewDecision = created ? "added_as_person" : "matched_existing_person";
  await recordReviewDecision(admin, {
    review_identity: args.reviewIdentity,
    candidate_id: args.candidateId,
    candidate_type: "person_candidate",
    decision,
    canonical_entity_id: personId,
    canonical_entity_type: "person",
    decided_by: args.userId,
    reason: created ? "Published as CRM contact" : "Matched existing CRM contact",
    operation_identity: operationIdentity,
    previous_status: args.previousStatus ?? "pending",
    resulting_status: "accepted",
    metadata: { sources: args.sources ?? [] },
  });

  const snap = await loadPersonSnapshot(admin, personId);
  let companyName = snap?.company ?? args.companyName ?? null;
  if (snap?.client_id) {
    const { data: company } = await admin.from("clients").select("name").eq("id", snap.client_id).maybeSingle();
    companyName = company?.name ?? companyName;
  }

  const warning = !email
    ? "Contact has no email yet."
    : !snap?.client_id && !companyId
      ? "Company association is still unresolved."
      : null;

  return {
    entity_id: personId,
    entity_type: "person",
    decision,
    created,
    matched,
    display_name: snap?.display_name ?? snap?.name ?? displayName,
    visibility: snap?.visibility_state ?? "active",
    data_quality_status: snap?.data_quality_status ?? "accepted",
    is_role_inbox: false,
    company_id: snap?.client_id ?? companyId,
    company_name: companyName,
    email: snap?.email ?? email,
    warning,
  };
}

/**
 * Keep a role inbox linked to a Company without publishing as a People contact.
 */
export async function linkAsCompanyInbox(
  admin: SupabaseClient,
  args: {
    userId: string;
    reviewIdentity: string;
    candidateId: string | null;
    email: string | null;
    displayName: string;
    domain?: string | null;
    companyName?: string | null;
    matchedPersonId?: string | null;
    matchedCompanyId?: string | null;
    previousStatus?: string | null;
  },
): Promise<ReviewActionResult> {
  const operationIdentity = `link-inbox:${args.reviewIdentity}`;
  const email = normalizeEmail(String(args.email ?? "")) || null;
  const domain = normalizeDomain(args.domain ?? (email ? email.split("@")[1] : null));

  let companyId = args.matchedCompanyId ?? null;
  if (!companyId && domain) {
    const match = await resolveCompanyByDomain(admin, domain);
    companyId = match?.company_id ?? null;
  }

  if (!companyId && (args.companyName || domain)) {
    const name = args.companyName ?? domain ?? "Unknown company";
    const { data: company, error } = await admin.from("clients").insert({
      name,
      primary_domain: domain,
      company_type: "tool",
      source: "Google",
      relationship_owner_id: args.userId,
      data_quality_status: "accepted",
      visibility_state: "active",
      metadata: { linked_from_role_inbox: args.reviewIdentity },
    }).select("id, name").single();
    if (error) throw new Error(error.message);
    companyId = company!.id;
  }

  let personId = args.matchedPersonId ?? null;
  if (!personId && email) {
    const match = await resolvePersonByEmail(admin, email);
    personId = match?.person_id ?? null;
  }

  if (personId) {
    const { error } = await admin.from("contacts").update({
      is_role_inbox: true,
      role_inbox_label: "Company inbox",
      data_quality_status: "ignored",
      visibility_state: "suppressed",
      quality_reason: "linked_as_company_inbox",
      client_id: companyId,
      company: args.companyName ?? domain,
      suppressed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", personId);
    if (error) throw new Error(error.message);

    if (companyId) {
      await admin.from("company_people").upsert({
        company_id: companyId,
        person_id: personId,
        relationship_type: "other",
        is_primary: false,
      }, { onConflict: "company_id,person_id,relationship_type" });
    }
  }

  if (email) {
    await createSuppression(admin, {
      suppression_type: "email",
      suppression_key: email,
      owner_user_id: args.userId,
      entity_type: "person",
      entity_id: personId,
      reason: "linked_as_company_inbox",
      created_by: args.userId,
    });
  }

  await recordReviewDecision(admin, {
    review_identity: args.reviewIdentity,
    candidate_id: args.candidateId,
    candidate_type: "role_inbox",
    decision: "linked_as_company_inbox",
    canonical_entity_id: companyId,
    canonical_entity_type: "company",
    decided_by: args.userId,
    reason: "Kept as company inbox",
    operation_identity: operationIdentity,
    previous_status: args.previousStatus ?? "pending",
    resulting_status: "ignored",
  });

  let companyName: string | null = args.companyName ?? domain;
  if (companyId) {
    const { data: company } = await admin.from("clients").select("name").eq("id", companyId).maybeSingle();
    companyName = company?.name ?? companyName;
  }

  return {
    success: true,
    entity_id: companyId,
    entity_type: companyId ? "company" : null,
    decision: "linked_as_company_inbox",
    created: false,
    matched: !!companyId,
    display_name: args.displayName,
    visibility: "suppressed",
    company_id: companyId,
    company_name: companyName,
    warning: companyId ? null : "No company could be resolved for this inbox.",
  };
}

export async function suppressReviewIdentity(
  admin: SupabaseClient,
  args: {
    userId: string;
    reviewIdentity: string;
    candidateId: string | null;
    email: string | null;
    domain?: string | null;
    matchedPersonId?: string | null;
    matchedCompanyId?: string | null;
    entityType: "person" | "company" | "lead";
    displayName: string;
    previousStatus?: string | null;
    reason?: string;
  },
): Promise<ReviewActionResult> {
  const operationIdentity = `suppress:${args.reviewIdentity}`;
  const email = normalizeEmail(String(args.email ?? "")) || null;

  if (args.matchedPersonId || (args.entityType === "person" && args.reviewIdentity.startsWith("person:"))) {
    const personId = args.matchedPersonId
      ?? (args.reviewIdentity.startsWith("person:") ? args.reviewIdentity.slice("person:".length) : null);
    if (personId) {
      await admin.from("contacts").update({
        data_quality_status: "suppressed",
        visibility_state: "suppressed",
        suppressed_at: new Date().toISOString(),
        quality_reason: args.reason ?? "suppressed_in_review",
        updated_at: new Date().toISOString(),
      }).eq("id", personId);
    }
  }

  if (email) {
    await createSuppression(admin, {
      suppression_type: "email",
      suppression_key: email,
      owner_user_id: args.userId,
      entity_type: args.entityType,
      entity_id: args.matchedPersonId,
      reason: args.reason ?? "suppressed_in_review",
      created_by: args.userId,
    });
  }

  const domain = normalizeDomain(args.domain);
  if (domain) {
    await createSuppression(admin, {
      suppression_type: "domain",
      suppression_key: domain,
      owner_user_id: args.userId,
      entity_type: "company",
      entity_id: args.matchedCompanyId,
      reason: args.reason ?? "suppressed_in_review",
      created_by: args.userId,
    });
  }

  await recordReviewDecision(admin, {
    review_identity: args.reviewIdentity,
    candidate_id: args.candidateId,
    candidate_type: "automated_sender",
    decision: "suppressed",
    canonical_entity_id: args.matchedPersonId ?? args.matchedCompanyId,
    canonical_entity_type: args.entityType,
    decided_by: args.userId,
    reason: args.reason ?? "Suppressed in review",
    operation_identity: operationIdentity,
    previous_status: args.previousStatus ?? "pending",
    resulting_status: "ignored",
  });

  return {
    success: true,
    entity_id: args.matchedPersonId ?? args.matchedCompanyId,
    entity_type: args.entityType === "lead" ? null : args.entityType,
    decision: "suppressed",
    created: false,
    matched: false,
    display_name: args.displayName,
    visibility: "suppressed",
    company_id: args.matchedCompanyId,
    company_name: null,
    warning: null,
  };
}

/** Infer review candidate action type from email + reason signals. */
export function classifyReviewCandidateType(args: {
  entityType: string;
  email?: string | null;
  reason?: string | null;
  reviewReason?: string | null;
  reviewKind?: string | null;
  isRoleInbox?: boolean | null;
}): string {
  if (args.reviewKind === "possible_duplicate") return "possible_duplicate";
  if (args.reviewKind === "identity_conflict") return "identity_conflict";
  if (args.entityType === "company") {
    if (args.reviewKind === "missing_classification") return "uncertain_company";
    return "company_candidate";
  }
  if (args.entityType === "lead") return "lead_candidate";

  const reason = `${args.reason ?? ""} ${args.reviewReason ?? ""}`.toLowerCase();
  if (args.isRoleInbox || reason.includes("role inbox")) return "role_inbox";

  if (args.email) {
    const classified = classifyEmailSender(args.email);
    if (classified.category === "automated_sender" || classified.category === "infrastructure") {
      return "automated_sender";
    }
    if (classified.isRoleInbox || classified.category === "role_inbox") return "role_inbox";
  }

  if (reason.includes("automated") || reason.includes("no-reply") || reason.includes("noreply")) {
    return "automated_sender";
  }

  return "person_candidate";
}
