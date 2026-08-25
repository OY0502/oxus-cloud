/**
 * Idempotent CRM import quality reconciliation for existing Google-imported records.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseDomainInput } from "./crm/domain.ts";
import { resolveCompanyName } from "./crm/companyNaming.ts";
import { resolvePersonName } from "./crm/personNaming.ts";
import { classifyCompanyRelationship } from "./crm/relationshipClassification.ts";
import {
  aggregateSourceLabels,
  bandToQualityStatus,
  confidenceToBand,
  pickPrimaryContact,
  qualityToVisibility,
  scorePrimaryContact,
} from "./crm/confidence.ts";
import {
  classifyEmailSender,
  isInfrastructureHost,
  isInternalOxusEmail,
  KNOWN_PLATFORM_DOMAINS,
  shouldCreateCompanyFromDomain,
} from "./crm/senderClassification.ts";
import { canOverwriteField } from "./crmEntityResolution.ts";

export type ReconcileStats = {
  total_people: number;
  total_companies: number;
  active_people: number;
  active_companies: number;
  active_clients: number;
  needs_review_people: number;
  needs_review_companies: number;
  suppressed_people: number;
  suppressed_companies: number;
  role_inboxes: number;
  missing_last_interaction_people: number;
  missing_last_interaction_companies: number;
};

export type ReconcileReport = {
  run_key: string;
  companies_analyzed: number;
  people_analyzed: number;
  companies_corrected: number;
  people_corrected: number;
  moved_to_review: number;
  suppressed: number;
  relationships_reclassified: number;
  primary_contacts_updated: number;
  primary_contacts_removed: number;
  duplicates_merged: number;
  logos_queued: number;
  interactions_rebuilt: number;
  names_corrected: number;
  manual_preserved: number;
  before: ReconcileStats;
  after: ReconcileStats;
  examples: Array<{ type: string; before: string; after: string; reason?: string }>;
};

const AUTOMATED_INTERACTION_TYPES = new Set(["gmail_received", "notification", "system"]);

function isManualSource(source: string | null | undefined): boolean {
  const s = (source ?? "").toLowerCase();
  return !s || s === "manual" || s.includes("project") || s.includes("invoice") || s.includes("proposal");
}

function parseSourceLabels(source: string | null | undefined, entitySources: string[]): string[] {
  const labels = new Set<string>();
  const raw = (source ?? "").toLowerCase();
  if (!raw || raw === "manual") labels.add("Manual");
  if (raw.includes("google contact")) labels.add("Google Contacts");
  if (raw.includes("gmail") || raw.includes("google")) labels.add("Gmail");
  if (raw.includes("calendar")) labels.add("Google Calendar");
  if (raw.includes("project")) labels.add("Project");
  if (raw.includes("proposal") || raw.includes("quote")) labels.add("Proposal");
  if (raw.includes("stripe")) labels.add("Stripe");
  if (raw.includes("firecrawl")) labels.add("Firecrawl");
  for (const s of entitySources) {
    const map: Record<string, string> = {
      google_contacts: "Google Contacts",
      gmail: "Gmail",
      calendar: "Google Calendar",
      project: "Project",
      proposal: "Proposal",
      stripe: "Stripe",
      firecrawl: "Firecrawl",
      manual: "Manual",
    };
    labels.add(map[s] ?? s);
  }
  return [...labels];
}

async function collectStats(admin: SupabaseClient): Promise<ReconcileStats> {
  const { data: companies } = await admin.from("clients").select("company_type, visibility_state, data_quality_status, last_interaction_at").is("archived_at", null).is("soft_deleted_at", null);
  const { data: people } = await admin.from("contacts").select("visibility_state, data_quality_status, is_role_inbox, last_interaction_at").is("archived_at", null).is("soft_deleted_at", null);

  const activeCompanies = (companies ?? []).filter((c) => c.visibility_state === "active" || (!c.visibility_state && c.data_quality_status === "accepted"));
  const activePeople = (people ?? []).filter((p) => (p.visibility_state === "active" || (!p.visibility_state && p.data_quality_status === "accepted")) && !p.is_role_inbox);

  return {
    total_people: people?.length ?? 0,
    total_companies: companies?.length ?? 0,
    active_people: activePeople.length,
    active_companies: activeCompanies.length,
    active_clients: activeCompanies.filter((c) => c.company_type === "client").length,
    needs_review_people: (people ?? []).filter((p) => p.visibility_state === "needs_review" || p.data_quality_status === "needs_review").length,
    needs_review_companies: (companies ?? []).filter((c) => c.visibility_state === "needs_review" || c.data_quality_status === "needs_review").length,
    suppressed_people: (people ?? []).filter((p) => p.visibility_state === "suppressed" || p.data_quality_status === "suppressed").length,
    suppressed_companies: (companies ?? []).filter((c) => c.visibility_state === "suppressed" || c.data_quality_status === "suppressed").length,
    role_inboxes: (people ?? []).filter((p) => p.is_role_inbox).length,
    missing_last_interaction_people: (people ?? []).filter((p) => !p.last_interaction_at && p.visibility_state !== "suppressed").length,
    missing_last_interaction_companies: (companies ?? []).filter((c) => !c.last_interaction_at && c.visibility_state !== "suppressed").length,
  };
}

export async function reconcileCrmImportQuality(
  admin: SupabaseClient,
  options?: { dryRun?: boolean; userId?: string; runKey?: string },
): Promise<ReconcileReport> {
  // Legacy v1 quality reconcile — disabled when any connection uses CRM resolver v2
  const { count: v2Connections } = await admin
    .from("user_google_connections")
    .select("id", { count: "exact", head: true })
    .gte("crm_resolver_version", 2);
  if ((v2Connections ?? 0) > 0) {
    const before = await collectStats(admin);
    return {
      run_key: options?.runKey ?? "crm-reconcile-skipped-v2",
      companies_analyzed: 0,
      people_analyzed: 0,
      companies_corrected: 0,
      people_corrected: 0,
      moved_to_review: 0,
      suppressed: 0,
      relationships_reclassified: 0,
      primary_contacts_updated: 0,
      primary_contacts_removed: 0,
      duplicates_merged: 0,
      logos_queued: 0,
      interactions_rebuilt: 0,
      names_corrected: 0,
      manual_preserved: 0,
      before,
      after: before,
      examples: [{ type: "info", before: "v1 reconcile", after: "skipped", reason: "crm_resolver_version >= 2 active" }],
    };
  }

  const dryRun = options?.dryRun ?? false;
  const runKey = options?.runKey ?? `crm-reconcile-${new Date().toISOString().slice(0, 19)}`;
  const before = await collectStats(admin);

  const report: ReconcileReport = {
    run_key: runKey,
    companies_analyzed: 0,
    people_analyzed: 0,
    companies_corrected: 0,
    people_corrected: 0,
    moved_to_review: 0,
    suppressed: 0,
    relationships_reclassified: 0,
    primary_contacts_updated: 0,
    primary_contacts_removed: 0,
    duplicates_merged: 0,
    logos_queued: 0,
    interactions_rebuilt: 0,
    names_corrected: 0,
    manual_preserved: 0,
    before,
    after: before,
    examples: [],
  };

  let runId: string | null = null;
  if (!dryRun) {
    const { data: runRow } = await admin.from("crm_reconciliation_runs").insert({
      run_key: runKey,
      dry_run: false,
      triggered_by: options?.userId ?? null,
      status: "running",
      before_stats: before,
    }).select("id").single();
    runId = runRow?.id ?? null;
  }

  try {
    const { data: companies } = await admin.from("clients").select("*").is("archived_at", null).is("soft_deleted_at", null);
    const { data: people } = await admin.from("contacts").select("*").is("archived_at", null).is("soft_deleted_at", null);
    const { data: projects } = await admin.from("projects").select("id, organization_id, client_id, status, archived_at, contact_id");
    const { data: invoices } = await admin.from("invoices").select("id, client_id, status, contact_id");
    const { data: quotes } = await admin.from("quotes").select("id, organization_id, stage, contact_id");
    const { data: interactions } = await admin
      .from("google_interactions")
      .select("id, company_id, person_ids, occurred_at, interaction_type, direction, is_automated")
      .order("occurred_at", { ascending: false });
    const { data: entitySources } = await admin.from("crm_entity_sources").select("entity_type, entity_id, source_type");

    const sourcesByEntity = new Map<string, string[]>();
    for (const s of entitySources ?? []) {
      const key = `${s.entity_type}:${s.entity_id}`;
      const list = sourcesByEntity.get(key) ?? [];
      list.push(s.source_type);
      sourcesByEntity.set(key, list);
    }

    const projectsByCompany = new Map<string, typeof projects>();
    const projectContactIds = new Map<string, Set<string>>();
    for (const p of projects ?? []) {
      const cid = p.organization_id ?? p.client_id;
      if (!cid) continue;
      const list = projectsByCompany.get(cid) ?? [];
      list.push(p);
      projectsByCompany.set(cid, list);
      if (p.contact_id) {
        const set = projectContactIds.get(cid) ?? new Set();
        set.add(p.contact_id);
        projectContactIds.set(cid, set);
      }
    }

    const invoicesByCompany = new Map<string, typeof invoices>();
    const invoiceContactIds = new Map<string, Set<string>>();
    for (const inv of invoices ?? []) {
      if (!inv.client_id) continue;
      const list = invoicesByCompany.get(inv.client_id) ?? [];
      list.push(inv);
      invoicesByCompany.set(inv.client_id, list);
      if (inv.contact_id) {
        const set = invoiceContactIds.get(inv.client_id) ?? new Set();
        set.add(inv.contact_id);
        invoiceContactIds.set(inv.client_id, set);
      }
    }

    const quotesByCompany = new Map<string, typeof quotes>();
    for (const q of quotes ?? []) {
      if (!q.organization_id) continue;
      const list = quotesByCompany.get(q.organization_id) ?? [];
      list.push(q);
      quotesByCompany.set(q.organization_id, list);
    }

    const companyByRegistrable = new Map<string, string>();
    for (const c of companies ?? []) {
      const domain = (c.registrable_domain ?? c.primary_domain ?? "").toLowerCase();
      if (domain && !companyByRegistrable.has(domain)) companyByRegistrable.set(domain, c.id);
    }

    const logoQueue: Array<{ id: string; domain: string }> = [];

    for (const company of companies ?? []) {
      report.companies_analyzed++;
      if (company.manually_confirmed || company.merged_into_id) {
        report.manual_preserved++;
        continue;
      }

      const locked = (company.locked_fields ?? []) as string[];
      const provenance = (company.field_provenance ?? {}) as Record<string, unknown>;
      const host = company.normalized_host ?? company.primary_domain ?? company.website ?? "";
      const parsed = parseDomainInput(host);
      const registrable = parsed.registrableDomain ?? company.registrable_domain ?? company.primary_domain;
      const patch: Record<string, unknown> = {};

      if (registrable) {
        patch.registrable_domain = registrable;
        patch.normalized_host = parsed.normalizedHost || registrable;
        patch.host_subdomain = parsed.subdomain;
        if (canOverwriteField(locked, "primary_domain", provenance, "reconcile")) {
          patch.primary_domain = registrable;
          patch.website = `https://${registrable}`;
        }
      }

      const resolvedName = resolveCompanyName({
        domain: host || registrable || "",
        manuallyConfirmed: false,
        existingCrmName: isManualSource(company.source) ? company.name : null,
        confirmedName: company.display_name ?? company.name,
      });

      const companyProjects = projectsByCompany.get(company.id) ?? [];
      const companyInvoices = invoicesByCompany.get(company.id) ?? [];
      const companyQuotes = quotesByCompany.get(company.id) ?? [];
      const hasPaid = companyInvoices.some((i) => i.status === "paid");
      const hasSent = companyInvoices.some((i) => ["sent", "open", "partial"].includes(i.status ?? ""));
      const hasActiveProject = companyProjects.some((p) => !p.archived_at && ["in-progress", "planning"].includes(p.status ?? ""));
      const hasCompleted = companyProjects.some((p) => !p.archived_at && p.status === "completed");
      const hasAnyProject = companyProjects.some((p) => !p.archived_at);
      const hasOpenProposal = companyQuotes.some((q) => ["proposal", "scoping", "new-lead"].includes(q.stage ?? ""));
      const isInternal = registrable ? isInternalOxusEmail(`x@${registrable}`) || registrable.endsWith("oxus.agency") || registrable.endsWith("oxus.cloud") : false;

      const companyInteractions = (interactions ?? []).filter((i) => i.company_id === company.id);
      const meaningful = companyInteractions.filter((i) =>
        !i.is_automated && !AUTOMATED_INTERACTION_TYPES.has(i.interaction_type ?? "")
        && new Date(i.occurred_at) <= new Date(),
      );
      const twoWay = meaningful.filter((i) => i.direction === "two_way" || i.direction === "bidirectional");

      const relationship = classifyCompanyRelationship(registrable, {
        hasActiveProject: hasActiveProject || hasAnyProject,
        hasCompletedProject: hasCompleted,
        hasPaidInvoice: hasPaid,
        hasSentInvoice: hasSent,
        hasOpenProposal,
        isKnownPlatform: resolvedName.isPlatform,
        isInfrastructure: isInfrastructureHost(host || registrable || ""),
        isInternal,
        twoWayCommunication: twoWay.length >= 2,
        manuallyClassified: company.manually_confirmed ? company.company_type : undefined,
      });

      let suppress = resolvedName.shouldSuppress;
      if (hasAnyProject || hasPaid || hasSent || hasActiveProject || hasCompleted) {
        suppress = false;
      }
      if (!hasPaid && !hasSent && !hasActiveProject && !hasCompleted && !hasAnyProject && resolvedName.isPlatform) {
        suppress = true;
      }
      if (!shouldCreateCompanyFromDomain(host || registrable || "") && !hasPaid && !hasActiveProject && !hasAnyProject && !resolvedName.isPlatform) {
        suppress = true;
      }

      const band = confidenceToBand(resolvedName.confidence);
      let quality = bandToQualityStatus(band, suppress);
      if (!suppress && quality === "suppressed" && (hasAnyProject || hasPaid || hasSent)) {
        quality = "accepted";
      }
      if (!suppress && quality === "suppressed" && resolvedName.qualityReason && !resolvedName.isPlatform) {
        quality = "needs_review";
      }
      const visibility = qualityToVisibility(quality);

      if (canOverwriteField(locked, "name", provenance, "reconcile") && resolvedName.displayName !== company.name) {
        patch.name = resolvedName.displayName;
        patch.display_name = resolvedName.displayName;
        patch.normalized_name = resolvedName.normalizedName;
        patch.name_confidence = resolvedName.confidence;
        patch.name_source = resolvedName.source;
        report.names_corrected++;
      }

      if (canOverwriteField(locked, "company_type", provenance, "reconcile") && relationship.companyType !== company.company_type) {
        patch.company_type = relationship.companyType;
        patch.classification_confidence = relationship.confidence;
        patch.classification_evidence = { evidence: relationship.evidence };
        report.relationships_reclassified++;
      } else if ((hasAnyProject || hasPaid || hasSent) && relationship.companyType === "client" && company.company_type !== "client") {
        patch.company_type = "client";
        patch.classification_confidence = relationship.confidence;
        patch.classification_evidence = { evidence: relationship.evidence };
        report.relationships_reclassified++;
      }

      if (quality !== company.data_quality_status || visibility !== company.visibility_state) {
        patch.data_quality_status = quality;
        patch.visibility_state = visibility;
        patch.needs_review = quality === "needs_review";
        patch.quality_reason = resolvedName.qualityReason ?? (relationship.evidence.includes("insufficient_evidence") ? "No evidence that this Company is a Client" : null);
        if (quality === "needs_review") report.moved_to_review++;
        if (quality === "suppressed") {
          patch.suppressed_at = new Date().toISOString();
          report.suppressed++;
        }
      }

      patch.import_confidence = resolvedName.confidence;
      patch.import_confidence_band = band;

      const entitySourceList = sourcesByEntity.get(`company:${company.id}`) ?? [];
      const aggSources = parseSourceLabels(company.source, entitySourceList);
      patch.aggregated_sources = aggSources;
      patch.source = aggregateSourceLabels(aggSources);

      if (meaningful.length > 0) {
        const latest = meaningful[0];
        const earliest = meaningful[meaningful.length - 1];
        patch.last_interaction_at = latest.occurred_at;
        patch.first_interaction_at = earliest.occurred_at;
        patch.last_interaction_type = latest.interaction_type;
        patch.last_interaction_direction = latest.direction;
        patch.interaction_count = meaningful.length;
        patch.two_way_thread_count = twoWay.length;
        report.interactions_rebuilt++;
      }

      const futureMeetings = companyInteractions.filter((i) =>
        i.interaction_type === "calendar_event" && new Date(i.occurred_at) > new Date(),
      );
      if (futureMeetings.length > 0) {
        patch.next_meeting_at = futureMeetings[futureMeetings.length - 1].occurred_at;
      }

      if (Object.keys(patch).length > 0) {
        const beforeLabel = `${company.name} (${company.company_type}/${company.data_quality_status})`;
        const afterLabel = `${String(patch.display_name ?? patch.name ?? company.name)} (${String(patch.company_type ?? company.company_type)}/${String(patch.data_quality_status ?? company.data_quality_status)})`;
        if (beforeLabel !== afterLabel && report.examples.length < 20) {
          report.examples.push({
            type: "company",
            before: beforeLabel,
            after: afterLabel,
            reason: String(patch.quality_reason ?? ""),
          });
        }
        if (!dryRun) {
          await admin.from("clients").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", company.id);
        }
        report.companies_corrected++;
        if (!dryRun && visibility === "active" && relationship.companyType !== "tool" && registrable && company.logo_status !== "resolved") {
          logoQueue.push({ id: company.id, domain: registrable });
        }
      }
    }

    const peopleByCompany = new Map<string, Array<Record<string, unknown>>>();
    for (const p of people ?? []) {
      if (!p.client_id) continue;
      const list = peopleByCompany.get(p.client_id) ?? [];
      list.push(p);
      peopleByCompany.set(p.client_id, list);
    }

    for (const person of people ?? []) {
      report.people_analyzed++;
      if (person.manually_confirmed || person.merged_into_id) {
        report.manual_preserved++;
        continue;
      }

      const locked = (person.locked_fields ?? []) as string[];
      const provenance = (person.field_provenance ?? {}) as Record<string, unknown>;
      const email = person.email ?? "";
      const resolved = resolvePersonName({
        email,
        displayName: person.name,
        crmExistingName: isManualSource(person.source) ? person.name : null,
      });

      const patch: Record<string, unknown> = {};
      const band = confidenceToBand(resolved.confidence);
      let quality = bandToQualityStatus(band, resolved.shouldSuppress);
      if (resolved.isRoleInbox && !resolved.shouldSuppress) {
        quality = "needs_review";
      }
      const visibility = resolved.isRoleInbox && quality === "accepted"
        ? "active"
        : qualityToVisibility(quality, resolved.isRoleInbox);

      if (canOverwriteField(locked, "name", provenance, "reconcile")) {
        if (resolved.displayName !== person.name) {
          patch.name = resolved.displayName;
          patch.display_name = resolved.displayName;
          patch.first_name = resolved.firstName;
          patch.last_name = resolved.lastName;
          report.names_corrected++;
        }
        patch.name_confidence = resolved.confidence;
        patch.name_source = resolved.source;
      }

      patch.is_role_inbox = resolved.isRoleInbox;
      patch.role_inbox_label = resolved.roleInboxLabel;
      patch.is_automated_sender = resolved.isAutomatedSender;

      if (quality !== person.data_quality_status || visibility !== person.visibility_state) {
        patch.data_quality_status = quality;
        patch.visibility_state = visibility;
        patch.quality_reason = resolved.qualityReason;
        if (quality === "needs_review") report.moved_to_review++;
        if (quality === "suppressed") {
          patch.suppressed_at = new Date().toISOString();
          report.suppressed++;
        }
      }

      patch.import_confidence = resolved.confidence;
      patch.import_confidence_band = band;

      const entitySourceList = sourcesByEntity.get(`person:${person.id}`) ?? [];
      const aggSources = parseSourceLabels(person.source, entitySourceList);
      patch.aggregated_sources = aggSources;
      patch.source = aggregateSourceLabels(aggSources);

      const personInteractions = (interactions ?? []).filter((i) =>
        (i.person_ids as string[] | null)?.includes(person.id),
      );
      const meaningful = personInteractions.filter((i) =>
        !i.is_automated && !AUTOMATED_INTERACTION_TYPES.has(i.interaction_type ?? "")
        && new Date(i.occurred_at) <= new Date(),
      );
      const twoWay = meaningful.filter((i) => i.direction === "two_way" || i.direction === "bidirectional");
      if (meaningful.length > 0) {
        patch.last_interaction_at = meaningful[0].occurred_at;
        patch.last_contact_at = meaningful[0].occurred_at;
        patch.first_interaction_at = meaningful[meaningful.length - 1].occurred_at;
        patch.interaction_count = meaningful.length;
        patch.two_way_thread_count = twoWay.length;
        patch.last_interaction_type = meaningful[0].interaction_type;
        patch.last_interaction_direction = meaningful[0].direction;
        report.interactions_rebuilt++;
      }

      if (Object.keys(patch).length > 0) {
        if (report.examples.length < 25 && patch.name && patch.name !== person.name) {
          report.examples.push({
            type: "person",
            before: `${person.name} <${person.email ?? ""}>`,
            after: String(patch.name),
            reason: String(patch.quality_reason ?? ""),
          });
        }
        if (!dryRun) {
          await admin.from("contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", person.id);
        }
        report.people_corrected++;
      }
    }

    // Deterministic duplicate merge: same registrable domain
    const dupCompanies = new Map<string, string[]>();
    for (const c of companies ?? []) {
      const d = (c.registrable_domain ?? c.primary_domain ?? "").toLowerCase();
      if (!d) continue;
      const list = dupCompanies.get(d) ?? [];
      list.push(c.id);
      dupCompanies.set(d, list);
    }
    for (const [, ids] of dupCompanies) {
      if (ids.length < 2) continue;
      const rows = (companies ?? []).filter((c) => ids.includes(c.id));
      const keeper = rows.find((c) => c.manually_confirmed)
        ?? rows.find((c) => (projectsByCompany.get(c.id) ?? []).length > 0)
        ?? rows.find((c) => (invoicesByCompany.get(c.id) ?? []).length > 0)
        ?? rows[0];
      for (const c of rows) {
        if (c.id === keeper.id) continue;
        if (!dryRun) {
          await admin.from("clients").update({
            visibility_state: "merged",
            data_quality_status: "suppressed",
            merged_into_id: keeper.id,
            suppressed_at: new Date().toISOString(),
            quality_reason: "Deterministic duplicate merged into parent company",
          }).eq("id", c.id);
          await admin.from("contacts").update({ client_id: keeper.id }).eq("client_id", c.id);
        }
        report.duplicates_merged++;
      }
    }

    // Primary contact scoring
    for (const company of companies ?? []) {
      if (company.manually_confirmed || company.merged_into_id) continue;
      const linked = peopleByCompany.get(company.id) ?? [];
      if (linked.length === 0) {
        if (company.primary_contact_id && !dryRun) {
          await admin.from("clients").update({ primary_contact_id: null }).eq("id", company.id);
          report.primary_contacts_removed++;
        }
        continue;
      }

      const scored = linked.map((p) => scorePrimaryContact({
        personId: String(p.id),
        isRoleInbox: !!p.is_role_inbox,
        isAutomated: !!p.is_automated_sender,
        hasReliableName: Number(p.name_confidence ?? 0) >= 0.7 && String(p.name) !== "Unknown contact",
        nameConfidence: Number(p.name_confidence ?? 0.5),
        twoWayCount: Number(p.two_way_thread_count ?? 0),
        meetingCount: Number(p.meeting_count ?? 0),
        isDecisionMaker: !!p.decision_maker,
        isBillingContact: !!p.billing_contact,
        isProjectContact: projectContactIds.get(company.id)?.has(String(p.id)),
        isInvoiceContact: invoiceContactIds.get(company.id)?.has(String(p.id)),
        recentInteractionAt: (p.last_interaction_at as string | null) ?? null,
        visibilityState: String(p.visibility_state ?? p.data_quality_status),
        manuallySelected: company.primary_contact_id === p.id && p.manually_confirmed,
      }));

      const best = pickPrimaryContact(scored);
      const newPrimary = best?.personId ?? null;
      if (newPrimary !== company.primary_contact_id) {
        if (!dryRun) {
          await admin.from("clients").update({ primary_contact_id: newPrimary }).eq("id", company.id);
          if (newPrimary) {
            await admin.from("company_people").upsert(
              { company_id: company.id, person_id: newPrimary, relationship_type: "client_contact", is_primary: true },
              { onConflict: "company_id,person_id,relationship_type" },
            );
          }
        }
        if (!newPrimary) report.primary_contacts_removed++;
        else report.primary_contacts_updated++;
      }
    }

    report.logos_queued = logoQueue.length;
    report.after = await collectStats(admin);

    if (!dryRun && runId) {
      await admin.from("crm_reconciliation_runs").update({
        status: "completed",
        after_stats: report.after,
        report,
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
    }

    return report;
  } catch (e) {
    if (!dryRun && runId) {
      await admin.from("crm_reconciliation_runs").update({
        status: "failed",
        error_message: (e as Error).message,
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
    }
    throw e;
  }
}
