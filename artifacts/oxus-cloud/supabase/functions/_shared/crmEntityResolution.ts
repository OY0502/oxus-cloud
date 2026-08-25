import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  extractDomainFromEmail,
  isFreeEmailDomain,
  normalizeDomain,
  normalizeEmail,
} from "./google-auth.ts";

export type PersonMatch = {
  person_id: string;
  confidence: number;
  reason: string;
  source: string;
};

export type CompanyMatch = {
  company_id: string;
  confidence: number;
  reason: string;
  source: string;
};

export async function isSuppressed(
  admin: SupabaseClient,
  suppressionType: string,
  suppressionKey: string,
  ownerUserId?: string,
): Promise<boolean> {
  let query = admin
    .from("crm_entity_suppressions")
    .select("id")
    .eq("suppression_type", suppressionType)
    .eq("suppression_key", suppressionKey);
  const { data } = await query.maybeSingle();
  if (data) return true;
  if (ownerUserId) {
    const { data: userScoped } = await admin
      .from("crm_entity_suppressions")
      .select("id")
      .eq("owner_user_id", ownerUserId)
      .eq("suppression_type", suppressionType)
      .eq("suppression_key", suppressionKey)
      .maybeSingle();
    if (userScoped) return true;
  }
  return false;
}

export async function resolvePersonByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<PersonMatch | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const { data: direct } = await admin
    .from("contacts")
    .select("id")
    .ilike("email", normalized)
    .maybeSingle();
  if (direct?.id) {
    return { person_id: direct.id, confidence: 1, reason: "exact_email", source: "crm" };
  }

  const { data: alt } = await admin
    .from("contacts")
    .select("id")
    .contains("alternate_emails", [normalized])
    .maybeSingle();
  if (alt?.id) {
    return { person_id: alt.id, confidence: 0.95, reason: "alternate_email", source: "crm" };
  }

  const { data: mapping } = await admin
    .from("person_provider_mappings")
    .select("person_id")
    .eq("provider", "google")
    .ilike("external_email", normalized)
    .maybeSingle();
  if (mapping?.person_id) {
    return { person_id: mapping.person_id, confidence: 0.92, reason: "google_provider", source: "google" };
  }

  return null;
}

export async function resolveCompanyByDomain(
  admin: SupabaseClient,
  domainInput: string | null | undefined,
): Promise<CompanyMatch | null> {
  const domain = normalizeDomain(domainInput);
  if (!domain || isFreeEmailDomain(domain)) return null;

  const { data: byPrimary } = await admin
    .from("clients")
    .select("id")
    .ilike("primary_domain", domain)
    .maybeSingle();
  if (byPrimary?.id) {
    return { company_id: byPrimary.id, confidence: 1, reason: "primary_domain", source: "crm" };
  }

  const { data: byWebsite } = await admin
    .from("clients")
    .select("id, website")
    .not("website", "is", null);
  for (const row of byWebsite ?? []) {
    const websiteDomain = normalizeDomain(row.website ?? "");
    if (websiteDomain === domain) {
      return { company_id: row.id, confidence: 0.95, reason: "website_domain", source: "crm" };
    }
  }

  const { data: mapping } = await admin
    .from("company_provider_mappings")
    .select("company_id")
    .eq("provider", "google")
    .eq("external_id", domain)
    .maybeSingle();
  if (mapping?.company_id) {
    return { company_id: mapping.company_id, confidence: 0.9, reason: "google_provider", source: "google" };
  }

  return null;
}

export async function resolveCompanyFromEmail(
  admin: SupabaseClient,
  email: string,
): Promise<CompanyMatch | null> {
  const domain = extractDomainFromEmail(email);
  if (!domain || isFreeEmailDomain(domain)) return null;
  return resolveCompanyByDomain(admin, domain);
}

export type FieldProvenance = Record<string, { source: string; updated_at: string; confidence?: number }>;

export function canOverwriteField(
  lockedFields: string[] | null | undefined,
  field: string,
  provenance: FieldProvenance | null | undefined,
  newSource: string,
): boolean {
  if (lockedFields?.includes(field)) return false;
  const existing = provenance?.[field];
  if (!existing) return true;
  if (existing.source === "manual") return false;
  const priority: Record<string, number> = {
    manual: 100,
    verified_provider: 80,
    google_contacts: 60,
    gmail: 55,
    calendar: 50,
    firecrawl: 45,
    ai_inferred: 30,
    stripe: 70,
    proposal: 65,
    project: 65,
  };
  return (priority[newSource] ?? 20) >= (priority[existing.source] ?? 0);
}

export async function createSuppression(
  admin: SupabaseClient,
  input: {
    suppression_type: string;
    suppression_key: string;
    owner_user_id?: string;
    entity_type?: string;
    entity_id?: string;
    reason?: string;
    created_by?: string;
  },
): Promise<void> {
  await admin.from("crm_entity_suppressions").upsert(
    {
      scope: input.owner_user_id ? "user" : "workspace",
      owner_user_id: input.owner_user_id ?? null,
      suppression_type: input.suppression_type,
      suppression_key: input.suppression_key,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      reason: input.reason ?? null,
      created_by: input.created_by ?? null,
    },
    { onConflict: "scope,suppression_type,suppression_key" },
  );
}

export async function recordEntitySource(
  admin: SupabaseClient,
  entityType: string,
  entityId: string,
  sourceType: string,
  sourceId?: string,
  confidence?: number,
): Promise<void> {
  await admin.from("crm_entity_sources").upsert(
    {
      entity_type: entityType,
      entity_id: entityId,
      source_type: sourceType,
      source_id: sourceId ?? null,
      confidence: confidence ?? null,
    },
    { onConflict: "entity_type,entity_id,source_type,source_id" },
  );
}
