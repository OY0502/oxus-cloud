/**
 * CRM resolver v2 — staged evidence → identity → canonical pipeline.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  extractDomainFromEmail,
  isFreeEmailDomain,
  normalizeEmail,
  type GoogleConnectionRow,
} from "../google-auth.ts";
import { parseDomainInput } from "../crm/domain.ts";
import { resolvePersonName } from "../crm/personNaming.ts";
import { resolveCompanyName } from "../crm/companyNaming.ts";
import { classifyCompanyRelationship } from "../crm/relationshipClassification.ts";
import {
  aggregateSourceLabels,
  pickPrimaryContact,
  scorePrimaryContact,
} from "../crm/confidence.ts";
import {
  classifyEmailSender,
  shouldCreateCompanyFromDomain,
  KNOWN_PLATFORM_DOMAINS,
} from "../crm/senderClassification.ts";
import { canOverwriteField, recordEntitySource } from "../crmEntityResolution.ts";
import { getValidGoogleAccessToken } from "../google-auth.ts";
import { resolveCompanyLogo } from "../resolveCompanyLogo.ts";
import { resolvePersonPhotoFromGoogle } from "../resolvePersonPhoto.ts";
import { classifyAttendeeExclusion, publicationVisibilityFromExclusion } from "./exclusion.ts";
import { CRM_RESOLVER_VERSION, RESOLVER_STAGES, type PipelineCounts, type ResolverRunRow, type ResolverStage } from "./types.ts";

const BATCH = {
  evidence: 200,
  identities: 100,
  resolve: 75,
  activities: 250,
  media: 8,
} as const;

function nextStage(stage: ResolverStage): ResolverStage {
  const idx = RESOLVER_STAGES.indexOf(stage);
  return RESOLVER_STAGES[Math.min(idx + 1, RESOLVER_STAGES.length - 1)] ?? "completed";
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureIncrementalResolverRun(
  admin: SupabaseClient,
  connectionId: string,
  ownerUserId: string,
): Promise<ResolverRunRow> {
  const { data: existing } = await admin
    .from("crm_resolver_runs")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("status", "running")
    .maybeSingle();
  if (existing) return existing as ResolverRunRow;

  const runKey = `crm-v2-incr-${connectionId.slice(0, 8)}-${Date.now()}`;
  const { data: run, error } = await admin
    .from("crm_resolver_runs")
    .insert({
      run_key: runKey,
      owner_user_id: ownerUserId,
      connection_id: connectionId,
      run_type: "incremental",
      crm_resolver_version: CRM_RESOLVER_VERSION,
      current_stage: "sync_source_evidence",
      status: "running",
    })
    .select("*")
    .single();
  if (error || !run) throw new Error(error?.message ?? "Failed to create resolver run");
  return run as ResolverRunRow;
}

export async function acquireMigrationLock(
  admin: SupabaseClient,
  connectionId: string,
): Promise<{ locked: boolean; run: ResolverRunRow | null }> {
  const { data: existing } = await admin
    .from("crm_resolver_runs")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("status", "running")
    .maybeSingle();
  if (existing) return { locked: false, run: existing as ResolverRunRow };

  const { data: conn } = await admin
    .from("user_google_connections")
    .select("id, user_id, google_email, crm_resolver_version")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) return { locked: false, run: null };

  const runKey = `crm-v2-${connectionId.slice(0, 8)}-${Date.now()}`;
  const { data: run, error } = await admin
    .from("crm_resolver_runs")
    .insert({
      run_key: runKey,
      owner_user_id: conn.user_id,
      connection_id: connectionId,
      run_type: "migration",
      crm_resolver_version: CRM_RESOLVER_VERSION,
      current_stage: "sync_source_evidence",
      status: "running",
    })
    .select("*")
    .single();
  if (error) return { locked: false, run: null };
  return { locked: true, run: run as ResolverRunRow };
}

export async function snapshotMigrationAudit(
  admin: SupabaseClient,
  migrationRunId: string,
): Promise<number> {
  const { data: people } = await admin
    .from("contacts")
    .select("id, display_name, name, visibility_state, relationship_type, client_id")
    .is("archived_at", null);
  const { data: companies } = await admin
    .from("clients")
    .select("id, display_name, name, visibility_state, company_type, primary_contact_id")
    .is("archived_at", null);

  const rows = [
    ...(people ?? []).map((p) => ({
      migration_run_id: migrationRunId,
      entity_type: "person",
      canonical_record_id: p.id,
      old_visibility: p.visibility_state,
      old_relationship_type: p.relationship_type,
      old_primary_association_id: p.client_id,
      old_display_name: p.display_name ?? p.name,
      migration_action: "snapshot",
    })),
    ...(companies ?? []).map((c) => ({
      migration_run_id: migrationRunId,
      entity_type: "company",
      canonical_record_id: c.id,
      old_visibility: c.visibility_state,
      old_relationship_type: c.company_type,
      old_primary_association_id: c.primary_contact_id,
      old_display_name: c.display_name ?? c.name,
      migration_action: "snapshot",
    })),
  ];
  if (rows.length === 0) return 0;
  const { error } = await admin.from("crm_migration_audit").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Stage 1: Map legacy provider rows into crm_source_* evidence. */
export async function syncSourceEvidence(
  admin: SupabaseClient,
  run: ResolverRunRow,
  checkpoint: Record<string, unknown>,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };
  const offset = Number(checkpoint.evidence_offset ?? 0);
  const ownerUserId = run.owner_user_id;
  const connectionId = run.connection_id;

  // Google Contacts from google_interactions
  let q = admin
    .from("google_interactions")
    .select("*")
    .eq("interaction_type", "contact")
    .order("created_at", { ascending: true })
    .range(offset, offset + BATCH.evidence - 1);
  if (connectionId) q = q.eq("connection_id", connectionId);
  const { data: contacts } = await q;

  for (const row of contacts ?? []) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(String(meta.primary_email ?? row.participant_emails?.[0] ?? ""));
    if (!email) { counts.skipped++; continue; }
    const externalId = String(row.external_id ?? email);
    const hash = await sha256Hex(JSON.stringify({ email, meta }));
    const { error } = await admin.from("crm_source_people").upsert({
      owner_user_id: ownerUserId,
      connection_id: row.connection_id,
      provider: "google",
      source_type: "google_contact",
      external_id: externalId,
      normalized_email: email,
      display_name: String(meta.display_name ?? row.subject ?? ""),
      structured_first_name: meta.first_name ? String(meta.first_name) : null,
      structured_last_name: meta.last_name ? String(meta.last_name) : null,
      organization_name: meta.organization ? String(meta.organization) : null,
      job_title: meta.job_title ? String(meta.job_title) : null,
      photo_url: meta.photo_url ? String(meta.photo_url) : null,
      registrable_domain: email ? parseDomainInput(extractDomainFromEmail(email) ?? "").registrableDomain : null,
      source_confidence: 0.92,
      raw_metadata: meta,
      content_hash: hash,
      migration_run_id: run.id,
      last_seen_at: row.occurred_at ?? new Date().toISOString(),
    }, { onConflict: "owner_user_id,provider,source_type,external_id" });
    if (error) counts.failed++; else counts.processed++;
  }

  // Calendar attendees
  let attQ = admin
    .from("google_calendar_attendees")
    .select("*")
    .order("created_at", { ascending: true })
    .range(Number(checkpoint.attendee_offset ?? 0), Number(checkpoint.attendee_offset ?? 0) + BATCH.evidence - 1);
  if (connectionId) attQ = attQ.eq("connection_id", connectionId);
  const { data: attendees } = await attQ;

  for (const att of attendees ?? []) {
    if (att.exclusion_reason) { counts.skipped++; continue; }
    const hash = await sha256Hex(`${att.normalized_email}:${att.display_name}:${att.external_event_id}`);
    const { error } = await admin.from("crm_source_people").upsert({
      owner_user_id: ownerUserId,
      connection_id: att.connection_id,
      provider: "google",
      source_type: "google_calendar_attendee",
      external_id: `${att.external_calendar_id}:${att.external_event_id}:${att.normalized_email}`,
      normalized_email: att.normalized_email,
      display_name: att.display_name,
      registrable_domain: att.registrable_domain,
      source_confidence: Number(att.source_confidence ?? 0.85),
      raw_metadata: { response_status: att.response_status, event_start_at: att.event_start_at },
      content_hash: hash,
      migration_run_id: run.id,
      last_seen_at: att.last_seen_at,
    }, { onConflict: "owner_user_id,provider,source_type,external_id" });
    if (error) counts.failed++; else counts.processed++;
  }

  // Gmail participants from threads
  let gtQ = admin
    .from("google_gmail_threads")
    .select("id, connection_id, participant_emails, subject, latest_internal_date, metadata")
    .order("created_at", { ascending: true })
    .range(Number(checkpoint.gmail_offset ?? 0), Number(checkpoint.gmail_offset ?? 0) + BATCH.evidence - 1);
  if (connectionId) gtQ = gtQ.eq("connection_id", connectionId);
  const { data: threads } = await gtQ;

  for (const thread of threads ?? []) {
    for (const rawEmail of (thread.participant_emails ?? []) as string[]) {
      const email = normalizeEmail(rawEmail);
      if (!email) continue;
      const sender = classifyEmailSender(email);
      const externalId = `gmail:${thread.id}:${email}`;
      const hash = await sha256Hex(`${thread.id}:${email}`);
      const confidence = sender.isAutomated ? 0.2 : sender.isRoleInbox ? 0.45 : sender.isCorporate ? 0.7 : 0.55;
      const { error } = await admin.from("crm_source_people").upsert({
        owner_user_id: ownerUserId,
        connection_id: thread.connection_id,
        provider: "google",
        source_type: "gmail_participant",
        external_id: externalId,
        normalized_email: email,
        display_name: null,
        registrable_domain: parseDomainInput(extractDomainFromEmail(email) ?? "").registrableDomain,
        source_confidence: confidence,
        raw_metadata: { thread_id: thread.id, subject: thread.subject },
        content_hash: hash,
        migration_run_id: run.id,
        last_seen_at: thread.latest_internal_date ?? new Date().toISOString(),
      }, { onConflict: "owner_user_id,provider,source_type,external_id" });
      if (error) counts.failed++; else counts.processed++;
    }
  }

  const doneContacts = (contacts?.length ?? 0) < BATCH.evidence;
  const doneAttendees = (attendees?.length ?? 0) < BATCH.evidence;
  const doneGmail = (threads?.length ?? 0) < BATCH.evidence;

  checkpoint.evidence_offset = doneContacts ? offset : offset + BATCH.evidence;
  checkpoint.attendee_offset = doneAttendees ? Number(checkpoint.attendee_offset ?? 0) : Number(checkpoint.attendee_offset ?? 0) + BATCH.evidence;
  checkpoint.gmail_offset = doneGmail ? Number(checkpoint.gmail_offset ?? 0) : Number(checkpoint.gmail_offset ?? 0) + BATCH.evidence;
  checkpoint.stage_complete = doneContacts && doneAttendees && doneGmail;

  await admin.from("crm_resolver_runs").update({
    stage_checkpoint: checkpoint,
    heartbeat_at: new Date().toISOString(),
  }).eq("id", run.id);

  return counts;
}

/** Stage 2: Build identity graph rows from source evidence. */
export async function normalizeSourceIdentities(
  admin: SupabaseClient,
  run: ResolverRunRow,
  checkpoint: Record<string, unknown>,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };
  const offset = Number(checkpoint.identity_offset ?? 0);

  const { data: sources } = await admin
    .from("crm_source_people")
    .select("*")
    .eq("owner_user_id", run.owner_user_id)
    .not("normalized_email", "is", null)
    .order("created_at", { ascending: true })
    .range(offset, offset + BATCH.identities - 1);

  for (const src of sources ?? []) {
    const email = src.normalized_email!;

    const identityType = src.source_type === "google_contact"
      ? "google_contact_id"
      : src.source_type === "google_calendar_attendee"
        ? "google_calendar_attendee"
        : src.source_type === "gmail_participant"
          ? "gmail_participant"
          : "email";

    let personId = src.canonical_person_id as string | null;
    if (!personId) {
      const { data: contact } = await admin.from("contacts").select("id").ilike("email", email).maybeSingle();
      personId = contact?.id ?? null;
      if (personId) {
        await admin.from("crm_source_people").update({ canonical_person_id: personId }).eq("id", src.id);
      }
    }
    if (!personId) { counts.skipped++; continue; }

    const { error: emailIdErr } = await admin.from("person_identities").upsert({
      owner_user_id: run.owner_user_id,
      person_id: personId,
      identity_type: "email",
      normalized_value: email,
      source_type: src.source_type,
      source_id: src.id,
      confidence: src.source_confidence,
      verified: false,
      crm_resolver_version: CRM_RESOLVER_VERSION,
      last_seen_at: src.last_seen_at,
    }, { onConflict: "owner_user_id,identity_type,normalized_value" });

    const { error: srcIdErr } = await admin.from("person_identities").upsert({
      owner_user_id: run.owner_user_id,
      person_id: personId,
      identity_type: identityType,
      normalized_value: src.external_id,
      source_type: src.source_type,
      source_id: src.id,
      confidence: src.source_confidence,
      crm_resolver_version: CRM_RESOLVER_VERSION,
      last_seen_at: src.last_seen_at,
    }, { onConflict: "owner_user_id,identity_type,normalized_value" });

    if (emailIdErr || srcIdErr) counts.failed++; else counts.processed++;
  }

  checkpoint.identity_offset = (sources?.length ?? 0) < BATCH.identities ? offset : offset + BATCH.identities;
  checkpoint.stage_complete = (sources?.length ?? 0) < BATCH.identities;
  await admin.from("crm_resolver_runs").update({ stage_checkpoint: checkpoint, heartbeat_at: new Date().toISOString() }).eq("id", run.id);
  return counts;
}

/** Stage 3: Resolve canonical People from source evidence with source authority. */
export async function resolvePeople(
  admin: SupabaseClient,
  run: ResolverRunRow,
  connection: GoogleConnectionRow | null,
  checkpoint: Record<string, unknown>,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };
  const offset = Number(checkpoint.people_offset ?? 0);

  const { data: sources } = await admin
    .from("crm_source_people")
    .select("*")
    .eq("owner_user_id", run.owner_user_id)
    .eq("processing_status", "pending")
    .order("source_confidence", { ascending: false })
    .range(offset, offset + BATCH.resolve - 1);

  for (const src of sources ?? []) {
    const email = normalizeEmail(src.normalized_email ?? "");
    if (!email) { counts.skipped++; continue; }

    const exclusion = classifyAttendeeExclusion({
      email,
      connectedAccountEmail: connection?.google_email,
      displayName: src.display_name,
    });
    const visibility = publicationVisibilityFromExclusion(exclusion);

    // Skip gmail-only weak identities unless repeated or structured contact/calendar exists
    if (src.source_type === "gmail_participant" && Number(src.source_confidence) < 0.65) {
      await admin.from("crm_source_people").update({
        processing_status: "skipped",
        raw_metadata: { ...src.raw_metadata as object, skip_reason: "weak_gmail_only" },
      }).eq("id", src.id);
      counts.skipped++;
      continue;
    }

    const { data: existingIdentity } = await admin
      .from("person_identities")
      .select("person_id")
      .eq("owner_user_id", run.owner_user_id)
      .eq("identity_type", "email")
      .eq("normalized_value", email)
      .maybeSingle();

    let personId = existingIdentity?.person_id ?? src.canonical_person_id ?? null;

    const structuredName = [src.structured_first_name, src.structured_last_name].filter(Boolean).join(" ").trim() || null;
    const nameResult = resolvePersonName({
      email,
      googleStructuredName: src.source_type === "google_contact" ? structuredName : null,
      calendarDisplayName: src.source_type === "google_calendar_attendee" ? src.display_name : null,
      displayName: src.display_name,
    });

    if (!personId && visibility === "suppressed") {
      await admin.from("crm_source_people").update({ processing_status: "suppressed" }).eq("id", src.id);
      counts.skipped++;
      continue;
    }

    if (!personId) {
      const { data: inserted, error } = await admin.from("contacts").insert({
        name: nameResult.displayName,
        display_name: nameResult.displayName,
        first_name: nameResult.firstName,
        last_name: nameResult.lastName,
        email,
        primary_email: email,
        job_title: src.job_title,
        source: src.source_type === "google_contact" ? "Google Contacts" : src.source_type === "google_calendar_attendee" ? "Google Calendar" : "Gmail",
        relationship_type: "unknown",
        type: "client",
        name_confidence: nameResult.confidence,
        name_source: nameResult.source,
        identity_confidence: src.source_confidence,
        identity_quality_reason: exclusion ?? nameResult.qualityReason,
        visibility_state: visibility,
        data_quality_status: visibility === "active" ? "accepted" : visibility === "needs_review" ? "needs_review" : "suppressed",
        is_role_inbox: classifyEmailSender(email).isRoleInbox,
        is_automated_sender: classifyEmailSender(email).isAutomated,
        crm_resolver_version: CRM_RESOLVER_VERSION,
        canonical_person_key: email,
      }).select("id").single();
      if (error) { counts.failed++; continue; }
      personId = inserted.id;
      counts.processed++;
    } else {
      const { data: person } = await admin.from("contacts").select("*").eq("id", personId).single();
      if (person && !person.manually_confirmed) {
        const updates: Record<string, unknown> = {
          crm_resolver_version: CRM_RESOLVER_VERSION,
          last_seen_at: src.last_seen_at,
        };
        if (canOverwriteField(person.locked_fields, "name", person.field_provenance, nameResult.source)) {
          if (nameResult.confidence > (person.name_confidence ?? 0)) {
            updates.name = nameResult.displayName;
            updates.display_name = nameResult.displayName;
            updates.first_name = nameResult.firstName;
            updates.last_name = nameResult.lastName;
            updates.name_confidence = nameResult.confidence;
            updates.name_source = nameResult.source;
          }
        }
        if (visibility === "suppressed" && !person.manually_confirmed) {
          updates.visibility_state = "suppressed";
          updates.data_quality_status = "suppressed";
        }
        await admin.from("contacts").update(updates).eq("id", personId);
      }
      counts.processed++;
    }

    await admin.from("person_identities").upsert({
      owner_user_id: run.owner_user_id,
      person_id: personId!,
      identity_type: "email",
      normalized_value: email,
      source_type: src.source_type,
      source_id: src.id,
      confidence: src.source_confidence,
      crm_resolver_version: CRM_RESOLVER_VERSION,
      last_seen_at: src.last_seen_at,
    }, { onConflict: "owner_user_id,identity_type,normalized_value" });

    await admin.from("crm_source_people").update({
      canonical_person_id: personId,
      processing_status: "resolved",
    }).eq("id", src.id);

    if (src.source_type === "google_contact" && src.raw_metadata) {
      const meta = src.raw_metadata as Record<string, unknown>;
      if (meta.resource_name) {
        await admin.from("person_provider_mappings").upsert({
          person_id: personId!,
          provider: "google",
          external_id: String(meta.resource_name),
          external_email: email,
          metadata: meta,
        }, { onConflict: "provider,external_id" });
      }
    }

    await recordEntitySource(admin, "person", personId!, src.source_type, src.external_id, src.source_confidence);

    if (connection?.id) {
      await admin
        .from("google_calendar_attendees")
        .update({ canonical_person_id: personId, processing_status: "resolved" })
        .eq("connection_id", connection.id)
        .eq("normalized_email", email)
        .is("exclusion_reason", null);
    }
  }

  checkpoint.people_offset = (sources?.length ?? 0) < BATCH.resolve ? offset : offset + BATCH.resolve;
  checkpoint.stage_complete = (sources?.length ?? 0) < BATCH.resolve;
  await admin.from("crm_resolver_runs").update({ stage_checkpoint: checkpoint, heartbeat_at: new Date().toISOString() }).eq("id", run.id);
  return counts;
}

/** Stage 4: Resolve Companies from domain evidence. */
export async function resolveCompanies(
  admin: SupabaseClient,
  run: ResolverRunRow,
  checkpoint: Record<string, unknown>,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };
  const offset = Number(checkpoint.company_offset ?? 0);

  const { data: people } = await admin
    .from("crm_source_people")
    .select("registrable_domain, organization_name, source_type, source_confidence, canonical_person_id")
    .eq("owner_user_id", run.owner_user_id)
    .not("registrable_domain", "is", null)
    .not("canonical_person_id", "is", null)
    .range(offset, offset + BATCH.resolve - 1);

  const seenDomains = new Set<string>();
  for (const row of people ?? []) {
    const domain = (row.registrable_domain ?? "").toLowerCase();
    if (!domain || seenDomains.has(domain)) { counts.skipped++; continue; }
    seenDomains.add(domain);

    if (isFreeEmailDomain(domain) || !shouldCreateCompanyFromDomain(domain)) {
      counts.skipped++;
      continue;
    }

    const { data: existingIdentity } = await admin
      .from("company_identities")
      .select("company_id")
      .eq("owner_user_id", run.owner_user_id)
      .eq("identity_type", "registrable_domain")
      .eq("normalized_value", domain)
      .maybeSingle();

    let companyId = existingIdentity?.company_id ?? null;
    const nameResult = resolveCompanyName({
      domain,
      googleOrgName: row.organization_name,
    });

    if (!companyId) {
      const { data: byDomain } = await admin.from("clients").select("id").ilike("registrable_domain", domain).maybeSingle();
      companyId = byDomain?.id ?? null;
    }

    const isPlatform = KNOWN_PLATFORM_DOMAINS.has(domain);
    const companyType = isPlatform ? "tool" : "unknown";

    if (!companyId) {
      const { data: inserted, error } = await admin.from("clients").insert({
        name: nameResult.displayName,
        display_name: nameResult.displayName,
        primary_domain: domain,
        registrable_domain: domain,
        company_type: companyType,
        source: row.source_type === "google_contact" ? "Google Contacts" : "Google Calendar",
        identity_confidence: row.source_confidence,
        visibility_state: isPlatform ? "active" : "active",
        crm_resolver_version: CRM_RESOLVER_VERSION,
        canonical_company_key: domain,
        logo_status: "pending",
      }).select("id").single();
      if (error) { counts.failed++; continue; }
      companyId = inserted.id;
    }

    await admin.from("company_identities").upsert({
      owner_user_id: run.owner_user_id,
      company_id: companyId!,
      identity_type: "registrable_domain",
      normalized_value: domain,
      source_type: row.source_type,
      confidence: row.source_confidence,
      crm_resolver_version: CRM_RESOLVER_VERSION,
    }, { onConflict: "owner_user_id,identity_type,normalized_value" });

    await admin.from("crm_source_companies").upsert({
      owner_user_id: run.owner_user_id,
      provider: "google",
      source_type: row.source_type,
      external_id: domain,
      organization_name: nameResult.displayName,
      registrable_domain: domain,
      canonical_company_id: companyId,
      processing_status: "resolved",
      source_confidence: row.source_confidence,
      migration_run_id: run.id,
    }, { onConflict: "owner_user_id,provider,source_type,external_id" });

    counts.processed++;
  }

  checkpoint.company_offset = (people?.length ?? 0) < BATCH.resolve ? offset : offset + BATCH.resolve;
  checkpoint.stage_complete = (people?.length ?? 0) < BATCH.resolve;
  await admin.from("crm_resolver_runs").update({ stage_checkpoint: checkpoint, heartbeat_at: new Date().toISOString() }).eq("id", run.id);
  return counts;
}

/** Stage 5: company_people associations + primary company on person. */
export async function resolveAssociations(
  admin: SupabaseClient,
  run: ResolverRunRow,
  checkpoint: Record<string, unknown>,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };
  const offset = Number(checkpoint.assoc_offset ?? 0);

  const { data: sources } = await admin
    .from("crm_source_people")
    .select("canonical_person_id, registrable_domain")
    .eq("owner_user_id", run.owner_user_id)
    .eq("processing_status", "resolved")
    .not("canonical_person_id", "is", null)
    .not("registrable_domain", "is", null)
    .range(offset, offset + BATCH.resolve - 1);

  for (const src of sources ?? []) {
    const domain = (src.registrable_domain ?? "").toLowerCase();
    const { data: companyIdentity } = await admin
      .from("company_identities")
      .select("company_id")
      .eq("owner_user_id", run.owner_user_id)
      .eq("identity_type", "registrable_domain")
      .eq("normalized_value", domain)
      .maybeSingle();
    if (!companyIdentity?.company_id) { counts.skipped++; continue; }

    const { error } = await admin.from("company_people").upsert({
      company_id: companyIdentity.company_id,
      person_id: src.canonical_person_id!,
      relationship_type: "client_contact",
      is_primary: false,
    }, { onConflict: "company_id,person_id,relationship_type", ignoreDuplicates: true });
    if (error) counts.failed++; else counts.processed++;

    const { data: person } = await admin.from("contacts").select("client_id, manually_confirmed, locked_fields").eq("id", src.canonical_person_id!).single();
    if (person && !person.client_id && !person.manually_confirmed) {
      await admin.from("contacts").update({ client_id: companyIdentity.company_id }).eq("id", src.canonical_person_id!);
    }
  }

  checkpoint.assoc_offset = (sources?.length ?? 0) < BATCH.resolve ? offset : offset + BATCH.resolve;
  checkpoint.stage_complete = (sources?.length ?? 0) < BATCH.resolve;
  await admin.from("crm_resolver_runs").update({ stage_checkpoint: checkpoint, heartbeat_at: new Date().toISOString() }).eq("id", run.id);
  return counts;
}

/** Stage 6: Publish visibility + aggregated sources on canonical entities. */
export async function publishCanonicalEntities(
  admin: SupabaseClient,
  run: ResolverRunRow,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };

  const { data: people } = await admin.from("contacts").select("id, source").eq("crm_resolver_version", CRM_RESOLVER_VERSION).is("archived_at", null);
  for (const person of people ?? []) {
    const { data: sources } = await admin.from("crm_entity_sources").select("source_type").eq("entity_type", "person").eq("entity_id", person.id);
    const labels = (sources ?? []).map((s) => s.source_type);
    const aggregated = parseSourceLabels(person.source, labels);
    await admin.from("contacts").update({
      aggregated_sources: aggregated,
      source: aggregateSourceLabels(aggregated),
      crm_resolver_version: CRM_RESOLVER_VERSION,
    }).eq("id", person.id);
    counts.processed++;
  }

  const { data: companies } = await admin.from("clients").select("id, source").eq("crm_resolver_version", CRM_RESOLVER_VERSION).is("archived_at", null);
  for (const company of companies ?? []) {
    const { data: sources } = await admin.from("crm_entity_sources").select("source_type").eq("entity_type", "company").eq("entity_id", company.id);
    const labels = (sources ?? []).map((s) => s.source_type);
    const aggregated = parseSourceLabels(company.source, labels);
    await admin.from("clients").update({
      aggregated_sources: aggregated,
      source: aggregateSourceLabels(aggregated),
    }).eq("id", company.id);
    counts.processed++;
  }

  return counts;
}

function parseSourceLabels(source: string | null, entitySources: string[]): string[] {
  const labels = new Set<string>();
  const map: Record<string, string> = {
    google_contact: "Google Contacts",
    google_contacts: "Google Contacts",
    google_calendar_attendee: "Google Calendar",
    calendar: "Google Calendar",
    gmail: "Gmail",
    gmail_participant: "Gmail",
    project: "Project",
    proposal: "Proposal",
    stripe: "Stripe",
    firecrawl: "Firecrawl",
    manual: "Manual",
  };
  for (const s of entitySources) labels.add(map[s] ?? s);
  if (labels.size === 0 && source) labels.add(source);
  return labels.size ? [...labels] : ["Manual"];
}

/** Stage 7: Rebuild normalized activities from Calendar + Gmail evidence. */
export async function rebuildActivities(
  admin: SupabaseClient,
  run: ResolverRunRow,
  connection: GoogleConnectionRow | null,
  checkpoint: Record<string, unknown>,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };
  const offset = Number(checkpoint.activity_offset ?? 0);

  let q = admin
    .from("google_calendar_attendees")
    .select("*")
    .is("exclusion_reason", null)
    .not("canonical_person_id", "is", null)
    .order("event_start_at", { ascending: true })
    .range(offset, offset + BATCH.activities - 1);
  if (connection?.id) q = q.eq("connection_id", connection.id);
  const { data: attendees } = await q;

  const now = new Date();
  for (const att of attendees ?? []) {
    const occurredAt = att.event_start_at ?? att.first_seen_at;
    const isFuture = occurredAt && new Date(occurredAt) > now;
    const externalId = `calendar:${att.external_calendar_id}:${att.external_event_id}:${att.normalized_email}`;

    const { data: srcInteraction } = await admin.from("crm_source_interactions").upsert({
      owner_user_id: run.owner_user_id,
      connection_id: att.connection_id,
      provider: "google",
      source_type: "google_calendar_attendee",
      external_id: externalId,
      person_id: att.canonical_person_id,
      activity_type: "calendar_meeting",
      occurred_at: occurredAt,
      direction: "bidirectional",
      title: "Calendar meeting",
      is_automated: false,
      is_meaningful: true,
      processing_status: "resolved",
      migration_run_id: run.id,
    }, { onConflict: "owner_user_id,provider,source_type,external_id" }).select("id").single();

    if (!isFuture) {
      const { error: actErr } = await admin.from("activities").upsert({
        kind: "info",
        title: "Meeting",
        description: null,
        entity_type: "contact",
        entity_id: att.canonical_person_id,
        contact_id: att.canonical_person_id,
        interaction_type: "meeting",
        occurred_at: occurredAt,
        source: "Google Calendar",
        metadata: { calendar_event_id: att.external_event_id, resolver_version: CRM_RESOLVER_VERSION },
      }, { onConflict: "id", ignoreDuplicates: true });
      if (actErr) counts.failed++;
    }

    const { data: existingPerson } = await admin
      .from("contacts")
      .select("last_interaction_at, next_meeting_at")
      .eq("id", att.canonical_person_id!)
      .maybeSingle();
    const personUpdates: Record<string, unknown> = {};
    if (isFuture) {
      const currentNext = existingPerson?.next_meeting_at
        ? new Date(existingPerson.next_meeting_at).getTime()
        : Infinity;
      if (occurredAt && new Date(occurredAt).getTime() < currentNext) {
        personUpdates.next_meeting_at = occurredAt;
      }
    } else if (occurredAt) {
      const currentLast = existingPerson?.last_interaction_at
        ? new Date(existingPerson.last_interaction_at).getTime()
        : 0;
      if (new Date(occurredAt).getTime() >= currentLast) {
        personUpdates.last_interaction_at = occurredAt;
        personUpdates.last_interaction_type = "meeting";
      }
    }
    if (Object.keys(personUpdates).length) {
      await admin.from("contacts").update(personUpdates).eq("id", att.canonical_person_id!);
    }
    counts.processed++;
    void srcInteraction;
  }

  // Recalculate meeting counts per person
  const { data: meetingCounts } = await admin
    .from("google_calendar_attendees")
    .select("canonical_person_id")
    .is("exclusion_reason", null)
    .not("canonical_person_id", "is", null);
  const byPerson = new Map<string, number>();
  for (const row of meetingCounts ?? []) {
    if (!row.canonical_person_id) continue;
    byPerson.set(row.canonical_person_id, (byPerson.get(row.canonical_person_id) ?? 0) + 1);
  }
  for (const [personId, count] of byPerson) {
    await admin.from("contacts").update({ meeting_count: count }).eq("id", personId);
  }

  checkpoint.activity_offset = (attendees?.length ?? 0) < BATCH.activities ? offset : offset + BATCH.activities;
  checkpoint.stage_complete = (attendees?.length ?? 0) < BATCH.activities;
  await admin.from("crm_resolver_runs").update({ stage_checkpoint: checkpoint, heartbeat_at: new Date().toISOString() }).eq("id", run.id);
  return counts;
}

/** Stage 8: Classify company/person relationships from Project/Invoice/Proposal evidence. */
export async function classifyRelationships(
  admin: SupabaseClient,
  run: ResolverRunRow,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };

  const { data: projects } = await admin.from("projects").select("id, organization_id, client_id, status, archived_at");
  const { data: invoices } = await admin.from("invoices").select("id, client_id, status");
  const { data: quotes } = await admin.from("quotes").select("id, organization_id, stage");
  const { data: companies } = await admin.from("clients").select("*").is("archived_at", null).is("soft_deleted_at", null);

  for (const company of companies ?? []) {
    if (company.manually_confirmed) { counts.skipped++; continue; }
    const companyProjects = (projects ?? []).filter((p) =>
      (p.organization_id === company.id || p.client_id === company.id) && !p.archived_at,
    );
    const companyInvoices = (invoices ?? []).filter((i) => i.client_id === company.id);
    const companyQuotes = (quotes ?? []).filter((q) => q.organization_id === company.id);

    const domain = (company.registrable_domain ?? company.primary_domain ?? "").toLowerCase();
    const classification = classifyCompanyRelationship(domain || null, {
      hasActiveProject: companyProjects.some((p) => !["completed", "archived", "cancelled"].includes(String(p.status ?? ""))),
      hasCompletedProject: companyProjects.some((p) => String(p.status) === "completed"),
      hasPaidInvoice: companyInvoices.some((i) => String(i.status) === "paid"),
      hasSentInvoice: companyInvoices.some((i) => ["sent", "paid", "overdue"].includes(String(i.status ?? ""))),
      hasOpenProposal: companyQuotes.some((q) => !["won", "lost", "declined"].includes(String(q.stage ?? ""))),
      isKnownPlatform: domain ? KNOWN_PLATFORM_DOMAINS.has(domain) : false,
      manuallyClassified: company.manually_confirmed ? company.company_type as "client" : undefined,
    });

    if (classification.companyType !== company.company_type) {
      await admin.from("clients").update({
        company_type: classification.companyType,
        classification_confidence: classification.confidence,
        classification_evidence: { evidence: classification.evidence },
        crm_resolver_version: CRM_RESOLVER_VERSION,
      }).eq("id", company.id);
      counts.processed++;
    } else {
      counts.skipped++;
    }
  }

  // Primary contacts
  const { data: allCompanies } = await admin.from("clients").select("id, primary_contact_id").is("archived_at", null);
  for (const company of allCompanies ?? []) {
    const { data: links } = await admin
      .from("company_people")
      .select("person_id, relationship_type, is_primary")
      .eq("company_id", company.id);
    const { data: peopleRows } = await admin
      .from("contacts")
      .select("id, last_interaction_at, meeting_count, decision_maker, manually_confirmed")
      .in("id", (links ?? []).map((l) => l.person_id));
    const scored = (links ?? []).map((link) => {
      const person = peopleRows?.find((p) => p.id === link.person_id);
      return scorePrimaryContact({
        personId: link.person_id,
        meetingCount: person?.meeting_count ?? 0,
        isDecisionMaker: person?.decision_maker ?? false,
        recentInteractionAt: person?.last_interaction_at,
        hasReliableName: (person?.manually_confirmed ?? false) || true,
        manuallySelected: link.is_primary,
      });
    });
    const primary = pickPrimaryContact(scored);
    if (primary && primary.personId !== company.primary_contact_id) {
      await admin.from("clients").update({ primary_contact_id: primary.personId }).eq("id", company.id);
      counts.processed++;
    }
  }

  return counts;
}

/** Stage 9: Execute photo and logo pipelines. */
export async function resolvePhotosAndLogos(
  admin: SupabaseClient,
  run: ResolverRunRow,
  connection: GoogleConnectionRow | null,
  checkpoint: Record<string, unknown>,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };
  const mediaOffset = Number(checkpoint.media_offset ?? 0);

  let accessToken: string | undefined;
  if (connection) {
    try {
      accessToken = await getValidGoogleAccessToken(admin, connection);
    } catch {
      accessToken = undefined;
    }
  }

  const { data: people } = await admin
    .from("contacts")
    .select("id, photo_status, manually_confirmed, avatar_url")
    .eq("visibility_state", "active")
    .in("photo_status", ["not_requested", "queued", "failed"])
    .is("archived_at", null)
    .range(mediaOffset, mediaOffset + BATCH.media - 1);

  for (const person of people ?? []) {
    if (person.manually_confirmed && person.avatar_url) { counts.skipped++; continue; }
    const { data: src } = await admin
      .from("crm_source_people")
      .select("photo_url, raw_metadata")
      .eq("canonical_person_id", person.id)
      .eq("source_type", "google_contact")
      .not("photo_url", "is", null)
      .limit(1)
      .maybeSingle();

    await admin.from("contacts").update({ photo_status: "resolving" }).eq("id", person.id);
    const result = await resolvePersonPhotoFromGoogle(admin, {
      personId: person.id,
      photoUrl: src?.photo_url ?? null,
      accessToken,
    });
    if (result.status === "resolved") counts.processed++;
    else if (result.status === "failed") counts.failed++;
    else counts.skipped++;
  }

  const { data: companies } = await admin
    .from("clients")
    .select("id, registrable_domain, primary_domain, website, logo_status, visibility_state, manual_logo_locked")
    .eq("visibility_state", "active")
    .in("logo_status", ["pending", "failed"])
    .is("archived_at", null)
    .range(mediaOffset, mediaOffset + BATCH.media - 1);

  for (const company of companies ?? []) {
    if (company.manual_logo_locked) { counts.skipped++; continue; }
    const domain = company.registrable_domain ?? company.primary_domain;
    if (!domain || isFreeEmailDomain(domain)) { counts.skipped++; continue; }
    const result = await resolveCompanyLogo(admin, {
      companyId: company.id,
      domain,
      websiteUrl: company.website,
    });
    await admin.from("clients").update({
      logo_url: result.logo_url,
      logo_storage_path: result.logo_storage_path,
      logo_source: result.logo_source,
      logo_status: result.status === "resolved" ? "resolved" : result.status === "fallback_favicon" ? "fallback_favicon" : result.status === "initials" ? "initials" : "failed",
      logo_resolved_at: result.status === "resolved" || result.status === "fallback_favicon" ? new Date().toISOString() : null,
    }).eq("id", company.id);
    if (result.status === "resolved" || result.status === "fallback_favicon") counts.processed++;
    else counts.failed++;
  }

  checkpoint.media_offset = mediaOffset + BATCH.media;
  checkpoint.stage_complete = (people?.length ?? 0) < BATCH.media && (companies?.length ?? 0) < BATCH.media;
  await admin.from("crm_resolver_runs").update({ stage_checkpoint: checkpoint, heartbeat_at: new Date().toISOString() }).eq("id", run.id);
  return counts;
}

/** Stage 10: Route uncertain records to Import Center review queue. */
export async function queueUncertainRecords(
  admin: SupabaseClient,
  run: ResolverRunRow,
  connection: GoogleConnectionRow | null,
): Promise<PipelineCounts> {
  const counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };

  const { data: reviewPeople } = await admin
    .from("contacts")
    .select("id, name, email, display_name, job_title, client_id, identity_confidence, quality_reason, visibility_state, data_quality_status")
    .or("visibility_state.eq.needs_review,data_quality_status.eq.needs_review")
    .is("archived_at", null)
    .is("soft_deleted_at", null);

  for (const person of reviewPeople ?? []) {
    if (["suppressed", "merged", "inactive"].includes(String(person.visibility_state))) {
      counts.skipped++;
      continue;
    }
    const { error } = await admin.from("crm_entity_candidates").upsert({
      owner_user_id: run.owner_user_id,
      connection_id: connection?.id ?? null,
      entity_type: "person",
      status: "pending",
      display_name: person.display_name ?? person.name,
      email: person.email,
      job_title: person.job_title,
      matched_person_id: person.id,
      matched_company_id: person.client_id,
      confidence: person.identity_confidence ?? 0.5,
      reason: person.quality_reason ?? "needs_review",
      evidence: { resolver_version: CRM_RESOLVER_VERSION, migration_run_id: run.id },
      suggested_relationship_type: "unknown",
      sources: ["CRM"],
    }, { onConflict: "owner_user_id,entity_type,email", ignoreDuplicates: false });
    if (error) counts.failed++; else counts.processed++;
  }

  const { data: reviewCompanies } = await admin
    .from("clients")
    .select("id, name, display_name, primary_domain, registrable_domain, website, company_type, import_confidence, quality_reason, visibility_state, data_quality_status, needs_review")
    .or("visibility_state.eq.needs_review,data_quality_status.eq.needs_review,needs_review.eq.true")
    .is("archived_at", null)
    .is("soft_deleted_at", null);

  for (const company of reviewCompanies ?? []) {
    if (["suppressed", "merged", "inactive"].includes(String(company.visibility_state))) {
      counts.skipped++;
      continue;
    }
    const domain = company.registrable_domain ?? company.primary_domain ?? null;
    const { error } = await admin.from("crm_entity_candidates").upsert({
      owner_user_id: run.owner_user_id,
      connection_id: connection?.id ?? null,
      entity_type: "company",
      status: "pending",
      display_name: company.display_name ?? company.name,
      domain,
      website: company.website,
      company_name: company.display_name ?? company.name,
      matched_company_id: company.id,
      confidence: company.import_confidence ?? 0.5,
      reason: company.quality_reason ?? (company.company_type === "unknown" ? "Unknown relationship" : "needs_review"),
      evidence: { resolver_version: CRM_RESOLVER_VERSION, migration_run_id: run.id },
      suggested_company_type: company.company_type === "client" ? "prospect" : company.company_type,
      sources: ["CRM"],
    }, { onConflict: "owner_user_id,entity_type,domain", ignoreDuplicates: false });
    if (error) {
      // Domain may be null — fall back to matched_company unique path via insert ignore
      const { error: insertErr } = await admin.from("crm_entity_candidates").insert({
        owner_user_id: run.owner_user_id,
        connection_id: connection?.id ?? null,
        entity_type: "company",
        status: "pending",
        display_name: company.display_name ?? company.name,
        domain,
        website: company.website,
        company_name: company.display_name ?? company.name,
        matched_company_id: company.id,
        confidence: company.import_confidence ?? 0.5,
        reason: company.quality_reason ?? "needs_review",
        evidence: { resolver_version: CRM_RESOLVER_VERSION, migration_run_id: run.id },
        suggested_company_type: company.company_type === "client" ? "prospect" : company.company_type,
        sources: ["CRM"],
      });
      if (insertErr) counts.failed++; else counts.processed++;
    } else {
      counts.processed++;
    }
  }

  return counts;
}

export async function runResolverStage(
  admin: SupabaseClient,
  runId: string,
): Promise<{ done: boolean; stage: ResolverStage; counts: PipelineCounts; report?: Record<string, unknown> }> {
  const { data: runRow } = await admin.from("crm_resolver_runs").select("*").eq("id", runId).single();
  if (!runRow) throw new Error("Resolver run not found");
  const run = runRow as ResolverRunRow;
  if (run.status !== "running") return { done: true, stage: "completed", counts: { processed: 0, failed: 0, skipped: 0 } };

  let connection: GoogleConnectionRow | null = null;
  if (run.connection_id) {
    const { data } = await admin.from("user_google_connections").select("*").eq("id", run.connection_id).single();
    connection = data as GoogleConnectionRow;
  }

  const checkpoint = { ...(run.stage_checkpoint ?? {}) } as Record<string, unknown>;
  let counts: PipelineCounts = { processed: 0, failed: 0, skipped: 0 };

  switch (run.current_stage) {
    case "sync_source_evidence":
      counts = await syncSourceEvidence(admin, run, checkpoint);
      break;
    case "normalize_source_identities":
      counts = await normalizeSourceIdentities(admin, run, checkpoint);
      break;
    case "resolve_people":
      counts = await resolvePeople(admin, run, connection, checkpoint);
      break;
    case "resolve_companies":
      counts = await resolveCompanies(admin, run, checkpoint);
      break;
    case "resolve_associations":
      counts = await resolveAssociations(admin, run, checkpoint);
      break;
    case "publish_canonical_entities":
      counts = await publishCanonicalEntities(admin, run);
      checkpoint.stage_complete = true;
      break;
    case "rebuild_activities":
      counts = await rebuildActivities(admin, run, connection, checkpoint);
      break;
    case "classify_relationships":
      counts = await classifyRelationships(admin, run);
      checkpoint.stage_complete = true;
      break;
    case "resolve_photos_and_logos":
      counts = await resolvePhotosAndLogos(admin, run, connection, checkpoint);
      break;
    case "queue_uncertain_records":
      counts = await queueUncertainRecords(admin, run, connection);
      checkpoint.stage_complete = true;
      break;
    case "completed":
      return { done: true, stage: "completed", counts };
  }

  const stageComplete = checkpoint.stage_complete === true;
  const next = stageComplete ? nextStage(run.current_stage) : run.current_stage;
  const done = next === "completed";

  const report = {
    ...(run.report ?? {}),
    [run.current_stage]: {
      processed: (run.processed_count ?? 0) + counts.processed,
      failed: (run.failed_count ?? 0) + counts.failed,
      skipped: (run.skipped_count ?? 0) + counts.skipped,
      completed_at: stageComplete ? new Date().toISOString() : null,
    },
  };

  await admin.from("crm_resolver_runs").update({
    current_stage: next,
    stage_checkpoint: stageComplete ? {} : checkpoint,
    processed_count: (run.processed_count ?? 0) + counts.processed,
    failed_count: (run.failed_count ?? 0) + counts.failed,
    skipped_count: (run.skipped_count ?? 0) + counts.skipped,
    report,
    status: done ? "completed" : "running",
    completed_at: done ? new Date().toISOString() : null,
    heartbeat_at: new Date().toISOString(),
  }).eq("id", run.id);

  if (done && connection) {
    await admin.from("user_google_connections").update({
      crm_resolver_version: CRM_RESOLVER_VERSION,
      crm_migrated_at: new Date().toISOString(),
      crm_migration_run_id: run.id,
    }).eq("id", connection.id);

    if (connection.id) {
      await linkAttendeesToPeople(admin, connection.id);
    }
  }

  return { done, stage: next, counts, report };
}

/** Backfill google_calendar_attendees from calendar_events + interactions. */
export async function backfillCalendarAttendees(
  admin: SupabaseClient,
  connection: GoogleConnectionRow,
): Promise<number> {
  let inserted = 0;
  const { data: events } = await admin
    .from("calendar_events")
    .select("id, external_id, external_calendar_id, connection_id, owner_user_id, attendee_emails, cancelled_at, metadata, event_date, start_time")
    .eq("connection_id", connection.id)
    .eq("provider", "google");

  for (const event of events ?? []) {
    const meta = (event.metadata ?? {}) as Record<string, unknown>;
    const attendeeDetails = (meta.attendees as Array<{ email?: string; displayName?: string; resource?: boolean; self?: boolean; responseStatus?: string }>) ?? [];
    const emails = attendeeDetails.length
      ? attendeeDetails
      : (event.attendee_emails ?? []).map((email: string) => ({ email }));

    for (const att of emails) {
      const email = normalizeEmail(att.email ?? "");
      if (!email) continue;
      const exclusion = classifyAttendeeExclusion({
        email,
        connectedAccountEmail: connection.google_email,
        displayName: att.displayName,
        resource: att.resource,
      });
      const domain = parseDomainInput(extractDomainFromEmail(email) ?? "").registrableDomain;
      const eventStart = event.start_time
        ? `${event.event_date}T${event.start_time}:00`
        : `${event.event_date}T00:00:00`;

      const { error } = await admin.from("google_calendar_attendees").upsert({
        connection_id: connection.id,
        owner_user_id: connection.user_id,
        calendar_event_id: event.id,
        external_event_id: event.external_id!,
        external_calendar_id: event.external_calendar_id!,
        attendee_email: email,
        normalized_email: email,
        display_name: att.displayName ?? null,
        response_status: att.responseStatus ?? null,
        is_resource: att.resource ?? false,
        is_self: att.self ?? false,
        event_start_at: eventStart,
        event_status: event.cancelled_at ? "cancelled" : "confirmed",
        registrable_domain: domain,
        exclusion_reason: exclusion,
        processing_status: exclusion ? "suppressed" : "pending",
        source_confidence: exclusion ? 0 : 0.88,
        raw_metadata: att,
      }, { onConflict: "connection_id,external_calendar_id,external_event_id,normalized_email" });
      if (!error) inserted++;
    }
  }
  return inserted;
}

export async function linkAttendeesToPeople(
  admin: SupabaseClient,
  connectionId: string,
): Promise<number> {
  let linked = 0;
  const { data: attendees } = await admin
    .from("google_calendar_attendees")
    .select("id, normalized_email")
    .eq("connection_id", connectionId)
    .is("canonical_person_id", null)
    .is("exclusion_reason", null);

  for (const att of attendees ?? []) {
    const { data: identity } = await admin
      .from("person_identities")
      .select("person_id")
      .eq("identity_type", "email")
      .eq("normalized_value", att.normalized_email)
      .maybeSingle();
    if (!identity?.person_id) {
      const { data: contact } = await admin.from("contacts").select("id").ilike("email", att.normalized_email).maybeSingle();
      if (contact?.id) {
        await admin.from("google_calendar_attendees").update({ canonical_person_id: contact.id }).eq("id", att.id);
        linked++;
      }
    } else {
      await admin.from("google_calendar_attendees").update({ canonical_person_id: identity.person_id }).eq("id", att.id);
      linked++;
    }
  }
  return linked;
}

export async function buildCalendarAuditReport(
  admin: SupabaseClient,
  connectionId: string,
): Promise<Record<string, unknown>> {
  const { count: eventCount } = await admin
    .from("calendar_events")
    .select("*", { count: "exact", head: true })
    .eq("connection_id", connectionId);

  const { data: attendees } = await admin
    .from("google_calendar_attendees")
    .select("id, normalized_email, display_name, exclusion_reason, processing_status, canonical_person_id")
    .eq("connection_id", connectionId);

  const external = (attendees ?? []).filter((a) => !a.exclusion_reason);
  const published = external.filter((a) => a.canonical_person_id && a.processing_status === "resolved");
  const review = external.filter((a) => !a.canonical_person_id);
  const suppressed = (attendees ?? []).filter((a) => a.exclusion_reason);

  const unresolvedReasons = review.map((a) => ({
    email: a.normalized_email,
    display_name: a.display_name,
    reason: "not_yet_resolved",
  }));

  const suppressedReasons = suppressed.reduce((acc: Record<string, number>, a) => {
    const r = a.exclusion_reason ?? "unknown";
    acc[r] = (acc[r] ?? 0) + 1;
    return acc;
  }, {});

  return {
    calendar_events: eventCount ?? 0,
    distinct_external_attendees: new Set(external.map((a) => a.normalized_email)).size,
    attendees_published: published.length,
    attendees_needs_review: review.length,
    attendees_suppressed: suppressed.length,
    attendees_missing: unresolvedReasons,
    suppressed_breakdown: suppressedReasons,
  };
}

export async function runFullAccountMigration(
  admin: SupabaseClient,
  connectionId: string,
): Promise<{ runId: string; report: Record<string, unknown> }> {
  const { locked, run } = await acquireMigrationLock(admin, connectionId);
  if (!run) throw new Error("Could not acquire migration lock");
  if (!locked) {
    return {
      runId: run.id,
      report: { migration_run_id: run.id, resumed: true, status: run.status, current_stage: run.current_stage },
    };
  }

  const { data: connection } = await admin.from("user_google_connections").select("*").eq("id", connectionId).single();
  if (!connection) throw new Error("Connection not found");

  await snapshotMigrationAudit(admin, run.id);
  const attendeesBackfilled = await backfillCalendarAttendees(admin, connection as GoogleConnectionRow);

  return {
    runId: run.id,
    report: {
      migration_run_id: run.id,
      attendees_backfilled: attendeesBackfilled,
      current_stage: run.current_stage,
      note: "Run stages via runResolverStage until done=true",
    },
  };
}
