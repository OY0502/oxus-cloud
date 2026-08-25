/**
 * Bounded Google import batches — each invocation completes within ~60s.
 * Cursors and progress persist in google_import_runs.source_progress.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getValidGoogleAccessToken,
  getGooglePeopleApiBaseUrl,
  googleApiFetch,
  GoogleSyncError,
  isAutomatedSender,
  isFreeEmailDomain,
  isInternalOxusEmail,
  normalizeDomain,
  normalizeEmail,
  extractDomainFromEmail,
  type GoogleConnectionRow,
} from "./google-auth.ts";
import {
  processGoogleInteractionRow,
  eventDateFromGoogleStart,
  computeContactConfidence,
} from "./crmGoogleEntityProcessing.ts";
import {
  ensureDefaultCalendarSelection,
  fetchGoogleCalendarList,
  getEnabledCalendarIds,
  defaultSelectedCalendars,
} from "./googleCalendarHelpers.ts";
import {
  isSuppressed,
  resolvePersonByEmail,
} from "./crmEntityResolution.ts";
import { collectParticipantEmails, parseGmailMessage } from "./googleEmailProcessing.ts";
import { scoreGmailThread, hasBulkEmailHeaders } from "./googleGmailFiltering.ts";
import {
  batchResolveBasicFromGmailMetadata,
  resolveBasicFromCalendarAttendee,
  resolveBasicFromContactInteraction,
} from "./googleCrmCoreSync.ts";
import {
  batchFilterEnrichmentThreads,
  batchGroupRelationshipThreads,
  loadRelationshipGroupsForEnrichment,
  ANALYSIS_VERSION,
  PROMPT_VERSION,
} from "./googleRelationshipGroups.ts";
import { analyzeRelationshipGroup, googleAnalysisModel } from "./googleRelationshipAi.ts";
import { triggerDevTask, shouldQueueTriggerDevTasks } from "./agent/triggerDev.ts";
import {
  ingestCalendarAttendees,
  ingestGoogleContactSource,
  usesCrmResolverV2,
} from "./crmIdentity/evidenceIngest.ts";
import { ensureIncrementalResolverRun, runResolverStage } from "./crmIdentity/pipeline.ts";
import { bump, processContactSignal, upsertSyncState, type SyncCounts } from "./googleSyncState.ts";

export const BATCH_LIMITS = {
  contacts_page: 100,
  contacts_ai_per_batch: 4,
  calendar_events: 100,
  gmail_discover_threads: Number(Deno.env.get("GOOGLE_GMAIL_DISCOVERY_PAGE_SIZE") || 50),
  gmail_process_threads: Number(Deno.env.get("GOOGLE_GMAIL_PROCESSING_BATCH_SIZE") || 30),
  resolve_basic_entities: Number(Deno.env.get("GOOGLE_RESOLVE_BASIC_BATCH_SIZE") || 50),
  resolve_entities: 50,
  enrichment_filter_threads: Number(Deno.env.get("GOOGLE_ENRICHMENT_FILTER_BATCH_SIZE") || 80),
  enrichment_group_threads: Number(Deno.env.get("GOOGLE_ENRICHMENT_GROUP_BATCH_SIZE") || 80),
  enrichment_relationship_groups: Number(Deno.env.get("GOOGLE_RELATIONSHIP_BATCH_SIZE") || 8),
  enrich_companies: 5,
} as const;

function getImportCostLimits() {
  return {
    maxThreads: Number(Deno.env.get("GOOGLE_INITIAL_IMPORT_MAX_THREADS") || 5000),
    maxAiGroups: Number(Deno.env.get("GOOGLE_INITIAL_IMPORT_MAX_AI_GROUPS") || 120),
    maxAiCostUsd: Number(Deno.env.get("GOOGLE_IMPORT_MAX_AI_COST_USD") || 25),
    maxFirecrawlCompanies: Number(Deno.env.get("GOOGLE_FIRECRAWL_MAX_COMPANIES_PER_RUN") || 50),
  };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeGmailThreadFingerprint(args: {
  threadId: string;
  subject: string | null;
  participants: string[];
  messageIds: string[];
  latestInternalDate: string | null;
}): Promise<string> {
  const normalized = JSON.stringify({
    thread_id: args.threadId,
    subject: (args.subject ?? "").trim().toLowerCase(),
    participants: [...args.participants].map((e) => e.toLowerCase()).sort(),
    message_ids: [...args.messageIds].sort(),
    latest: args.latestInternalDate,
  });
  return sha256Hex(normalized);
}

export type GoogleSyncBatchAction =
  | "validate"
  | "contacts_page"
  | "calendar_page"
  | "gmail_discover_page"
  | "resolve_basic_entities"
  | "resolve_entities"
  | "complete_core_sync"
  | "filter_enrichment_threads"
  | "group_relationships"
  | "enrich_relationship_batch"
  | "gmail_process_batch"
  | "reconcile_reset"
  | "enrich_companies"
  | "finalize";

export type SourceProgress = {
  contacts?: { page_token?: string | null; sync_token?: string | null; completed?: boolean };
  calendar?: { calendar_ids?: string[]; calendar_index?: number; page_token?: string | null; completed?: boolean };
  gmail?: {
    discover_page_token?: string | null;
    discovery_completed?: boolean;
    processing_completed?: boolean;
    core_metadata_completed?: boolean;
    history_id?: string | null;
    completed?: boolean;
  };
  core?: { completed?: boolean };
  resolve?: { completed?: boolean };
  enrichment?: {
    filter_completed?: boolean;
    grouping_completed?: boolean;
    completed?: boolean;
    paused?: boolean;
  };
  enrich?: { completed?: boolean; queued_ids?: string[] };
};

export type BatchResult = {
  action: GoogleSyncBatchAction;
  done: boolean;
  counts: SyncCounts;
  stage: string;
  source?: string;
  processed_in_batch?: number;
  message?: string;
};

type RunContext = {
  correlationId?: string;
  triggerRunId?: string | null;
};

async function loadImportContext(admin: SupabaseClient, importRunId: string) {
  const { data: run, error } = await admin.from("google_import_runs").select("*").eq("id", importRunId).single();
  if (error || !run) throw new GoogleSyncError("INVALID_WORKER_PAYLOAD", "Import run not found.");

  if (["cancelled", "completed", "completed_with_warnings", "failed", "timed_out"].includes(String(run.status))) {
    throw new GoogleSyncError("GOOGLE_SYNC_INTERRUPTED_BY_RECONNECT", "Import run is already terminal.");
  }

  const { data: connection } = await admin
    .from("user_google_connections")
    .select("*")
    .eq("id", run.connection_id)
    .single();
  if (!connection) throw new GoogleSyncError("GOOGLE_CONNECTION_NOT_FOUND", "Google connection not found.");
  if (connection.status !== "active") {
    throw new GoogleSyncError("GOOGLE_CONNECTION_REVOKED", "Google connection is not active.");
  }
  if (connection.user_id !== run.owner_user_id) {
    throw new GoogleSyncError("INVALID_WORKER_PAYLOAD", "Import run does not belong to this connection.");
  }

  const runGeneration = run.connection_generation == null ? null : Number(run.connection_generation);
  const connectionGeneration = Number((connection as { connection_generation?: number }).connection_generation ?? 1);
  if (runGeneration != null && runGeneration !== connectionGeneration) {
    throw new GoogleSyncError(
      "GOOGLE_SYNC_GENERATION_MISMATCH",
      "Import run belongs to a previous Google connection generation.",
    );
  }

  return {
    run,
    connection: connection as GoogleConnectionRow,
    counts: { ...(run.counts as SyncCounts ?? {}) },
    sourceProgress: { ...(run.source_progress as SourceProgress ?? {}) },
    sources: (run.sources as string[]) ?? [],
    processorVersion: Number(run.processor_version ?? 1),
    coreSyncStatus: String(run.core_sync_status ?? "pending"),
    enrichmentStatus: String(run.enrichment_status ?? "pending"),
  };
}

async function persistBatchProgress(
  admin: SupabaseClient,
  importRunId: string,
  patch: {
    progress_stage?: string;
    current_source?: string;
    progress_processed?: number;
    progress_total?: number;
    progress_percentage?: number;
    counts?: SyncCounts;
    source_progress?: SourceProgress;
    status?: string;
    core_sync_status?: string;
    enrichment_status?: string;
  },
) {
  const { data: current } = await admin
    .from("google_import_runs")
    .select("status, error_code, error, progress_stage, trigger_run_id, import_history, last_heartbeat_at")
    .eq("id", importRunId)
    .maybeSingle();

  const { reactivateImportRunPatch } = await import("./googleImportStatus.ts");
  const nextStage = patch.progress_stage ?? current?.progress_stage ?? undefined;
  const reactivation = current
    && ["timed_out", "failed"].includes(String(current.status))
    && nextStage
    && nextStage !== "failed"
    ? reactivateImportRunPatch(current as {
      error_code: string | null;
      error: string | null;
      trigger_run_id: string | null;
      import_history?: unknown;
    })
    : {};

  const activeStatus = current?.status === "queued" || current?.status === "starting"
    ? { status: "running" as const }
    : {};

  await admin.from("google_import_runs").update({
    ...reactivation,
    ...activeStatus,
    ...patch,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", importRunId);
}

async function trackAiCost(
  counts: SyncCounts,
  costMetrics: Record<string, unknown>,
  inputTokens = 0,
  outputTokens = 0,
): Promise<Record<string, unknown>> {
  const input = Number(costMetrics.input_tokens ?? 0) + inputTokens;
  const output = Number(costMetrics.output_tokens ?? 0) + outputTokens;
  const aiCalls = Number(costMetrics.ai_calls ?? counts.ai_calls ?? 0) + 1;
  const estimated = Number(costMetrics.estimated_cost_usd ?? 0) + (inputTokens * 0.000002) + (outputTokens * 0.000006);
  bump(counts, "ai_calls");
  return {
    ...costMetrics,
    input_tokens: input,
    output_tokens: output,
    ai_calls: aiCalls,
    estimated_cost_usd: estimated,
  };
}

async function batchValidate(
  admin: SupabaseClient,
  importRunId: string,
  ctx: RunContext,
): Promise<BatchResult> {
  const { run, connection, counts, sourceProgress } = await loadImportContext(admin, importRunId);
  await getValidGoogleAccessToken(admin, connection);

  let conn = connection;
  if ((run.sources as string[]).includes("calendar")) {
    conn = await ensureDefaultCalendarSelection(admin, connection);
  }

  await admin.from("google_import_runs").update({
    status: "running",
    started_at: run.started_at ?? new Date().toISOString(),
    progress_stage: "validating_connection",
    correlation_id: ctx.correlationId,
    trigger_run_id: ctx.triggerRunId ?? run.trigger_run_id,
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", importRunId);

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "validating_connection",
    current_source: "connection",
    counts,
    source_progress: sourceProgress,
    progress_processed: 0,
  });

  return { action: "validate", done: true, counts, stage: "validating_connection", processed_in_batch: 0 };
}

async function batchContactsPage(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const contactsProgress = sourceProgress.contacts ?? {};

  const { data: syncState } = await admin
    .from("google_sync_states")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("source", "contacts")
    .eq("resource_key", "default")
    .maybeSingle();

  let url = `/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,photos,metadata&pageSize=${BATCH_LIMITS.contacts_page}`;
  const syncToken = contactsProgress.sync_token ?? syncState?.sync_token;
  if (syncToken) {
    url = `/v1/people/me/connections?syncToken=${encodeURIComponent(syncToken)}&personFields=names,emailAddresses,phoneNumbers,organizations,photos,metadata&pageSize=${BATCH_LIMITS.contacts_page}`;
  }
  const pageToken = contactsProgress.page_token;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

  const resp = await googleApiFetch(accessToken, url, { baseUrl: getGooglePeopleApiBaseUrl() });
  const text = await resp.text();
  if (!resp.ok) {
    if (resp.status === 410 && syncToken) {
      sourceProgress.contacts = { page_token: null, sync_token: null, completed: false };
      await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts });
      return batchContactsPage(admin, importRunId, connection, counts, sourceProgress);
    }
    throw new Error(`Google Contacts sync failed: ${text.slice(0, 400)}`);
  }

  const payload = JSON.parse(text) as {
    connections?: Array<Record<string, unknown>>;
    nextPageToken?: string;
    nextSyncToken?: string;
  };

  let aiCalls = 0;
  for (const person of payload.connections ?? []) {
    bump(counts, "contacts_scanned");
    const resourceName = String(person.resourceName ?? "");
    const metadata = person.metadata as { deleted?: boolean } | undefined;
    if (metadata?.deleted) continue;

    const emails = ((person.emailAddresses as Array<{ value?: string }>) ?? [])
      .map((e) => normalizeEmail(e.value)).filter(Boolean) as string[];
    const primaryEmail = emails[0] ?? null;
    if (!primaryEmail || isInternalOxusEmail(primaryEmail)) continue;
    if (await isSuppressed(admin, "email", primaryEmail, connection.user_id)) continue;

    const names = (person.names as Array<{ displayName?: string; givenName?: string; familyName?: string }>) ?? [];
    const displayName = names[0]?.displayName ?? primaryEmail;
    const firstName = names[0]?.givenName ?? null;
    const lastName = names[0]?.familyName ?? null;
    const orgs = (person.organizations as Array<{ name?: string; title?: string }>) ?? [];
    const orgName = orgs[0]?.name ?? null;
    const jobTitle = orgs[0]?.title ?? null;
    const photos = (person.photos as Array<{ url?: string }>) ?? [];
    const photoUrl = photos[0]?.url ?? null;

    await admin.from("google_interactions").upsert(
      {
        connection_id: connection.id,
        owner_user_id: connection.user_id,
        interaction_type: "contact",
        external_id: resourceName || primaryEmail,
        occurred_at: new Date().toISOString(),
        subject: displayName,
        participant_emails: emails,
        snippet: orgName,
        metadata: {
          organization: orgName,
          job_title: jobTitle,
          display_name: displayName,
          first_name: firstName,
          last_name: lastName,
          primary_email: primaryEmail,
          photo_url: photoUrl,
          resource_name: resourceName,
        },
      },
      { onConflict: "connection_id,interaction_type,external_id" },
    );

    if (usesCrmResolverV2(connection)) {
      await ingestGoogleContactSource(admin, connection, {
        externalId: resourceName || primaryEmail,
        email: primaryEmail,
        displayName,
        firstName,
        lastName,
        organization: orgName,
        jobTitle,
        photoUrl,
        resourceName,
        rawMetadata: { emails },
      });
      bump(counts, "contacts_evidence_stored");
      continue;
    }

    const personMatch = await resolvePersonByEmail(admin, primaryEmail);
    if (personMatch && personMatch.confidence >= 0.9) {
      await admin.from("person_provider_mappings").upsert(
        {
          person_id: personMatch.person_id,
          provider: "google",
          external_id: resourceName,
          external_email: primaryEmail,
        },
        { onConflict: "provider,external_id" },
      );
      continue;
    }

    const baseConfidence = computeContactConfidence({
      email: primaryEmail,
      displayName,
      orgName,
      hasExistingPerson: false,
    });

    if (baseConfidence >= 0.88) {
      await resolveBasicFromContactInteraction(admin, connection, {
        email: primaryEmail,
        displayName,
        jobTitle,
        orgName,
        resourceName,
      }, counts);
      continue;
    }

    if (aiCalls < BATCH_LIMITS.contacts_ai_per_batch) {
      await processContactSignal(admin, connection, {
        email: primaryEmail,
        displayName,
        jobTitle,
        orgName,
        resourceName,
        emails,
      }, counts);
      aiCalls++;
    } else {
      bump(counts, "contacts_deferred");
    }
  }

  const nextPage = payload.nextPageToken ?? null;
  const done = !nextPage;
  sourceProgress.contacts = {
    page_token: nextPage,
    sync_token: done ? (payload.nextSyncToken ?? syncToken ?? null) : (syncToken ?? null),
    completed: done,
  };

  if (done) {
    await upsertSyncState(admin, connection, "contacts", "default", {
      sync_token: payload.nextSyncToken ?? syncState?.sync_token ?? null,
      initial_sync_completed: true,
      last_attempted_sync_at: new Date().toISOString(),
      last_successful_sync_at: new Date().toISOString(),
      last_error: null,
      next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "syncing_contacts",
    current_source: "contacts",
    progress_processed: counts.contacts_scanned ?? 0,
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "contacts_page",
    done,
    counts,
    stage: "syncing_contacts",
    source: "contacts",
    processed_in_batch: payload.connections?.length ?? 0,
  };
}

async function batchCalendarPage(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const calProgress = sourceProgress.calendar ?? { calendar_index: 0, calendar_ids: [] };
  const settings = connection.import_settings as Record<string, unknown>;
  const lookbackMonths = Number(settings.lookback_months ?? 12) || 12;
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - lookbackMonths);
  const timeMax = new Date();
  timeMax.setMonth(timeMax.getMonth() + 6);

  let calendarIds = calProgress.calendar_ids ?? [];
  if (calendarIds.length === 0) {
    const conn = await ensureDefaultCalendarSelection(admin, connection);
    const enabled = getEnabledCalendarIds(conn);
    if (enabled?.length) {
      calendarIds = enabled;
    } else {
      const accessToken = await getValidGoogleAccessToken(admin, connection);
      const calList = await fetchGoogleCalendarList(accessToken);
      calendarIds = defaultSelectedCalendars(calList).filter((c) => c.enabled !== false).map((c) => c.id);
    }
    if (calendarIds.length === 0) {
      sourceProgress.calendar = { ...calProgress, completed: true };
      bump(counts, "calendar_errors");
      await persistBatchProgress(admin, importRunId, {
        progress_stage: "syncing_calendar",
        source_progress: sourceProgress,
        counts,
      });
      return {
        action: "calendar_page",
        done: true,
        counts,
        stage: "syncing_calendar",
        source: "calendar",
        message: "No calendars selected for sync",
        processed_in_batch: 0,
      };
    }
    calProgress.calendar_ids = calendarIds;
    calProgress.calendar_index = 0;
    calProgress.page_token = null;
  }

  const calIndex = calProgress.calendar_index ?? 0;
  if (calIndex >= calendarIds.length) {
    sourceProgress.calendar = { ...calProgress, completed: true };
    await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts, progress_stage: "syncing_calendar" });
    return { action: "calendar_page", done: true, counts, stage: "syncing_calendar", source: "calendar", processed_in_batch: 0 };
  }

  const calendarId = calendarIds[calIndex]!;
  const { data: syncState } = await admin
    .from("google_sync_states")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("source", "calendar")
    .eq("resource_key", calendarId)
    .maybeSingle();

  let eventsUrl = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&maxResults=${BATCH_LIMITS.calendar_events}&timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
  if (syncState?.sync_token && syncState.initial_sync_completed) {
    eventsUrl = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?syncToken=${encodeURIComponent(syncState.sync_token)}`;
  } else if (calProgress.page_token) {
    eventsUrl += `&pageToken=${encodeURIComponent(calProgress.page_token)}`;
  }

  const resp = await googleApiFetch(accessToken, eventsUrl);
  const text = await resp.text();
  if (!resp.ok) {
    if (resp.status === 410 && syncState?.sync_token) {
      await admin.from("google_sync_states").update({ sync_token: null }).eq("id", syncState.id);
      calProgress.page_token = null;
      sourceProgress.calendar = calProgress;
      return batchCalendarPage(admin, importRunId, connection, counts, sourceProgress);
    }
    throw new Error(`Calendar sync failed: ${text.slice(0, 400)}`);
  }

  const payload = JSON.parse(text) as {
    items?: Array<Record<string, unknown>>;
    nextPageToken?: string;
    nextSyncToken?: string;
  };

  for (const event of payload.items ?? []) {
    bump(counts, "events_scanned");
    const eventId = String(event.id ?? "");
    if (!eventId) continue;
    const status = String(event.status ?? "confirmed");
    const start = (event.start as { dateTime?: string; date?: string }) ?? {};
    const eventDate = eventDateFromGoogleStart(start);
    const occurredAt = start.dateTime ?? (start.date ? `${start.date}T00:00:00` : new Date().toISOString());
    const attendeesRaw = ((event.attendees as Array<{ email?: string; displayName?: string; resource?: boolean; self?: boolean; responseStatus?: string }>) ?? []);
    const attendees = attendeesRaw
      .map((a) => normalizeEmail(a.email)).filter(Boolean) as string[];
    const organizer = (event.organizer as { email?: string })?.email ?? null;

    if (status !== "cancelled") {
      const { data: calRow, error: calError } = await admin.from("calendar_events").upsert(
        {
          title: String(event.summary ?? "Untitled meeting"),
          event_date: eventDate,
          start_time: start.dateTime ? start.dateTime.slice(11, 16) : null,
          end_time: (event.end as { dateTime?: string })?.dateTime?.slice(11, 16) ?? null,
          type: "meeting",
          location: String(event.location ?? "") || null,
          provider: "google",
          external_id: eventId,
          external_calendar_id: calendarId,
          connection_id: connection.id,
          owner_user_id: connection.user_id,
          organizer_email: organizer,
          attendee_emails: attendees,
          meeting_url: (event.hangoutLink as string) ?? null,
          html_link: (event.htmlLink as string) ?? null,
          metadata: { calendar_id: calendarId, attendees: attendeesRaw },
        },
        { onConflict: "connection_id,external_calendar_id,external_id", ignoreDuplicates: false },
      ).select("id").single();
      if (calError) {
        bump(counts, "calendar_errors");
        console.error("[google-sync] calendar_events upsert failed", calError.message);
      } else {
        bump(counts, "events_stored");
      }

      await admin.from("google_interactions").upsert(
        {
          connection_id: connection.id,
          owner_user_id: connection.user_id,
          interaction_type: "calendar_event",
          external_id: `${calendarId}:${eventId}`,
          occurred_at: occurredAt,
          subject: String(event.summary ?? ""),
          organizer_email: organizer,
          attendee_emails: attendees,
          participant_emails: attendees,
          snippet: String(event.description ?? "").slice(0, 500) || null,
          metadata: { calendar_id: calendarId, event_id: eventId, attendees: attendeesRaw },
        },
        { onConflict: "connection_id,interaction_type,external_id" },
      );

      if (usesCrmResolverV2(connection)) {
        const ingested = await ingestCalendarAttendees(admin, connection, {
          calendarEventId: calRow?.id ?? null,
          externalEventId: eventId,
          externalCalendarId: calendarId,
          eventStartAt: occurredAt,
          eventStatus: status,
          attendees: attendeesRaw,
        });
        bump(counts, "calendar_attendees_stored", ingested);
      } else {
        for (const email of attendees) {
          if (isInternalOxusEmail(email) || isAutomatedSender(email)) continue;
          if (await isSuppressed(admin, "email", email, connection.user_id)) continue;
          const personMatch = await resolvePersonByEmail(admin, email);
          if (!personMatch) {
            await resolveBasicFromCalendarAttendee(
              admin,
              connection,
              email,
              email,
              eventId,
              counts,
            );
          }
        }
      }
    }
  }

  const nextPage = payload.nextPageToken ?? null;
  if (nextPage) {
    calProgress.page_token = nextPage;
  } else {
    await upsertSyncState(admin, connection, "calendar", calendarId, {
      sync_token: payload.nextSyncToken ?? syncState?.sync_token ?? null,
      initial_sync_completed: true,
      last_attempted_sync_at: new Date().toISOString(),
      last_successful_sync_at: new Date().toISOString(),
      last_error: null,
      next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    calProgress.page_token = null;
    calProgress.calendar_index = calIndex + 1;
  }

  const done = (calProgress.calendar_index ?? 0) >= calendarIds.length && !nextPage;
  sourceProgress.calendar = { ...calProgress, completed: done };

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "syncing_calendar",
    current_source: "calendar",
    progress_processed: counts.events_scanned ?? 0,
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "calendar_page",
    done,
    counts,
    stage: "syncing_calendar",
    source: "calendar",
    processed_in_batch: payload.items?.length ?? 0,
  };
}

async function batchGmailDiscoverPage(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
  runType?: string,
): Promise<BatchResult> {
  if (!(connection.sources_enabled as Record<string, boolean>)?.gmail) {
    sourceProgress.gmail = { ...sourceProgress.gmail, discovery_completed: true, completed: true };
    await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts });
    return { action: "gmail_discover_page", done: true, counts, stage: "discovering_gmail_threads", source: "gmail" };
  }

  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const gmailProgress = sourceProgress.gmail ?? {};
  const settings = connection.import_settings as Record<string, unknown>;
  const lookbackMonths = Number(settings.lookback_months ?? 12) || 12;
  const afterDate = new Date();
  afterDate.setMonth(afterDate.getMonth() - lookbackMonths);
  const afterTs = Math.floor(afterDate.getTime() / 1000);

  const { data: syncState } = await admin
    .from("google_sync_states")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("source", "gmail")
    .eq("resource_key", "default")
    .maybeSingle();

  if (syncState?.committed_history_id || syncState?.history_id) {
    const startHistoryId = syncState.committed_history_id ?? syncState.history_id;
    if (runType === "incremental" || gmailProgress.discovery_completed) {
    const histResp = await googleApiFetch(
      accessToken,
      `/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(startHistoryId!)}&historyTypes=messageAdded&maxResults=100`,
    );
    const histText = await histResp.text();
    if (histResp.status === 404) {
      await admin.from("google_sync_states").update({
        history_id: null,
        committed_history_id: null,
        pending_history_id: null,
      }).eq("id", syncState!.id);
      gmailProgress.discover_page_token = null;
      sourceProgress.gmail = gmailProgress;
      return batchGmailDiscoverPage(admin, importRunId, connection, counts, sourceProgress, runType);
    }
    if (histResp.ok) {
      const hist = JSON.parse(histText) as {
        history?: Array<{ messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }> }>;
        historyId?: string;
        nextPageToken?: string;
      };
      for (const record of hist.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const threadId = added.message?.threadId;
          if (threadId) {
            await admin.from("google_gmail_threads").upsert(
              {
                connection_id: connection.id,
                import_run_id: importRunId,
                owner_user_id: connection.user_id,
                thread_id: threadId,
                relevance_status: "relevant",
                has_external_participant: true,
                relevance_reason: "incremental_history",
              },
              { onConflict: "connection_id,thread_id", ignoreDuplicates: false },
            );
            bump(counts, "threads_discovered");
          }
        }
      }
      if (hist.nextPageToken) {
        gmailProgress.discover_page_token = hist.nextPageToken;
        sourceProgress.gmail = gmailProgress;
        await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts, progress_stage: "discovering_gmail_threads" });
        return { action: "gmail_discover_page", done: false, counts, stage: "discovering_gmail_threads", source: "gmail" };
      }
      await upsertSyncState(admin, connection, "gmail", "default", {
        pending_history_id: hist.historyId ?? startHistoryId,
        last_attempted_sync_at: new Date().toISOString(),
        ...(runType === "incremental" ? { last_incremental_started_at: new Date().toISOString() } : {}),
      });
      sourceProgress.gmail = {
        ...gmailProgress,
        discovery_completed: true,
        history_id: hist.historyId ?? startHistoryId ?? null,
      };
      await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts, progress_stage: "discovering_gmail_threads" });
      return { action: "gmail_discover_page", done: true, counts, stage: "discovering_gmail_threads", source: "gmail" };
    }
    }
  }

  if (syncState?.history_id && gmailProgress.discovery_completed) {
    sourceProgress.gmail = { ...gmailProgress, discovery_completed: true };
    await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts });
    return { action: "gmail_discover_page", done: true, counts, stage: "discovering_gmail_threads", source: "gmail" };
  }

  let pageToken = gmailProgress.discover_page_token ?? "";
  const query = `after:${afterTs} -in:spam -in:trash`;
  const listUrl = `/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=${BATCH_LIMITS.gmail_discover_threads}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;

  const listResp = await googleApiFetch(accessToken, listUrl);
  const listText = await listResp.text();
  if (!listResp.ok) throw new Error(`Gmail thread list failed: ${listText.slice(0, 400)}`);
  const list = JSON.parse(listText) as { threads?: Array<{ id?: string }>; nextPageToken?: string };

  let discovered = 0;
  for (const thread of list.threads ?? []) {
    if (!thread.id) continue;
    const threadResp = await googleApiFetch(
      accessToken,
      `/gmail/v1/users/me/threads/${thread.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=Precedence`,
    );
    if (!threadResp.ok) continue;
    const threadData = await threadResp.json() as {
      id?: string;
      snippet?: string;
      messages?: Array<{ id?: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: { headers?: Array<{ name?: string; value?: string }> } }>;
    };

    const messages = threadData.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    const headers = lastMsg?.payload?.headers ?? [];
    if (hasNewsletterHeaders(headers)) {
      bump(counts, "ignored_records");
      continue;
    }

    const participants = new Set<string>();
    for (const msg of messages) {
      for (const h of msg.payload?.headers ?? []) {
        if (["From", "To", "Cc"].includes(h.name ?? "")) {
          for (const part of (h.value ?? "").split(",")) {
            const m = part.match(/<([^>]+@[^>]+)>/) ?? part.match(/([\w.+-]+@[\w.-]+)/);
            if (m?.[1]) participants.add(m[1].toLowerCase());
          }
        }
      }
    }

    const participantList = [...participants];
    const external = participantList.some((e) => !isInternalOxusEmail(e));
    const subject = headers.find((h) => h.name === "Subject")?.value ?? null;
    const scored = scoreGmailThread({
      subject,
      snippet: threadData.snippet ?? lastMsg?.snippet ?? null,
      participants: participantList,
      labels: lastMsg?.labelIds ?? [],
      ownerEmail: connection.google_email,
      headers,
      lastMessageAt: lastMsg?.internalDate
        ? new Date(Number(lastMsg.internalDate)).toISOString()
        : null,
      lookbackMonths: Number(settings.lookback_months ?? 12) || 12,
    });

    await admin.from("google_gmail_threads").upsert(
      {
        connection_id: connection.id,
        import_run_id: importRunId,
        owner_user_id: connection.user_id,
        thread_id: threadData.id ?? thread.id!,
        subject,
        snippet: (threadData.snippet ?? "").slice(0, 500),
        last_message_at: lastMsg?.internalDate
          ? new Date(Number(lastMsg.internalDate)).toISOString()
          : new Date().toISOString(),
        participant_emails: participantList,
        labels: lastMsg?.labelIds ?? [],
        has_external_participant: external,
        relevance_status: scored.coreRelevant ? "relevant" : "ignored",
        relevance_reason: scored.reason,
        enrichment_priority: scored.priorityScore,
        two_way_conversation: scored.twoWayConversation,
        enrichment_status: scored.coreRelevant ? "pending" : "noise",
        message_count: messages.length,
        metadata: {
          primary_external_email: scored.primaryExternalEmail,
          enrichment_eligible: scored.enrichmentEligible,
        },
      },
      { onConflict: "connection_id,thread_id", ignoreDuplicates: false },
    );

    bump(counts, scored.coreRelevant ? "threads_discovered" : "ignored_records");
    if (!scored.enrichmentEligible && scored.coreRelevant) bump(counts, "threads_skipped_as_noise");
    discovered++;
  }

  const nextPage = list.nextPageToken ?? null;
  const discoveryDone = !nextPage;
  const costLimits = getImportCostLimits();
  const totalDiscovered = (counts.threads_discovered ?? 0) + (counts.ignored_records ?? 0);
  if (totalDiscovered >= costLimits.maxThreads) {
    sourceProgress.gmail = {
      ...gmailProgress,
      discover_page_token: nextPage,
      discovery_completed: true,
    };
    bump(counts, "discovery_capped");
    await persistBatchProgress(admin, importRunId, {
      progress_stage: "discovering_gmail_threads",
      current_source: "gmail",
      counts,
      source_progress: sourceProgress,
    });
    return {
      action: "gmail_discover_page",
      done: true,
      counts,
      stage: "discovering_gmail_threads",
      source: "gmail",
      message: "Gmail discovery reached configured thread cap",
      processed_in_batch: discovered,
    };
  }

  if (discoveryDone) {
    const profileResp = await googleApiFetch(accessToken, "/gmail/v1/users/me/profile");
    const profile = profileResp.ok ? await profileResp.json() as { historyId?: string } : {};
    await upsertSyncState(admin, connection, "gmail", "default", {
      history_id: profile.historyId ?? syncState?.history_id ?? null,
      committed_history_id: profile.historyId ?? syncState?.committed_history_id ?? syncState?.history_id ?? null,
      pending_history_id: profile.historyId ?? null,
      initial_sync_completed: false,
      last_attempted_sync_at: new Date().toISOString(),
    });
    gmailProgress.history_id = profile.historyId ?? null;
  }

  sourceProgress.gmail = {
    ...gmailProgress,
    discover_page_token: nextPage,
    discovery_completed: discoveryDone,
  };

  bump(counts, "messages_scanned", discovered);

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "discovering_gmail_threads",
    current_source: "gmail",
    progress_processed: counts.threads_discovered ?? 0,
    progress_total: (counts.threads_discovered ?? 0) + (counts.ignored_records ?? 0),
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "gmail_discover_page",
    done: discoveryDone,
    counts,
    stage: "discovering_gmail_threads",
    source: "gmail",
    processed_in_batch: discovered,
  };
}

async function batchResolveBasicEntities(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  if (usesCrmResolverV2(connection)) {
    sourceProgress.gmail = { ...sourceProgress.gmail, core_metadata_completed: true };
    await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts });
    return {
      action: "resolve_basic_entities",
      done: true,
      counts,
      stage: "resolving_basic_people",
      message: "Skipped — CRM resolver v2 handles entity resolution",
      processed_in_batch: 0,
    };
  }
  const result = await batchResolveBasicFromGmailMetadata(
    admin,
    connection,
    importRunId,
    BATCH_LIMITS.resolve_basic_entities,
    counts,
  );

  if (result.done) {
    sourceProgress.gmail = { ...sourceProgress.gmail, core_metadata_completed: true };
  }

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "resolving_basic_people",
    current_source: "entities",
    progress_processed: counts.people_created ?? 0,
    progress_total: (counts.people_created ?? 0) + (counts.companies_created ?? 0),
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "resolve_basic_entities",
    done: result.done,
    counts,
    stage: result.done ? "resolving_basic_companies" : "resolving_basic_people",
    processed_in_batch: result.processed,
  };
}

async function batchCompleteCoreSync(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  const now = new Date().toISOString();
  const { data: currentRun } = await admin
    .from("google_import_runs")
    .select("core_sync_status, counts, warnings, enrichment_status, source_progress")
    .eq("id", importRunId)
    .maybeSingle();

  const existingProgress = {
    ...(currentRun?.source_progress as SourceProgress ?? {}),
    ...sourceProgress,
  };

  if (
    currentRun?.core_sync_status === "complete"
    && existingProgress.core?.completed
    && existingProgress.gmail?.completed !== false
  ) {
    return {
      action: "complete_core_sync",
      done: true,
      counts: { ...(currentRun.counts as SyncCounts ?? {}), ...counts },
      stage: "core_sync_complete",
      message: "Core CRM sync already complete",
      already_completed: true,
    };
  }

  await admin.from("google_import_runs").update({
    status: "running",
    progress_stage: "completing_core_sync",
    core_sync_status: "running",
    action_required: false,
    recovery_status: "idle",
    finalization_started_at: now,
    finalization_heartbeat_at: now,
    error_code: null,
    error: null,
    failed_at: null,
    completed_at: null,
    failed_stage: null,
    last_heartbeat_at: now,
  }).eq("id", importRunId);

  const [{ count: pendingCandidates }, { count: totalCandidates }] = await Promise.all([
    admin.from("crm_entity_candidates").select("id", { count: "exact", head: true })
      .eq("owner_user_id", connection.user_id)
      .eq("connection_id", connection.id)
      .eq("status", "pending"),
    admin.from("crm_entity_candidates").select("id", { count: "exact", head: true })
      .eq("owner_user_id", connection.user_id)
      .eq("connection_id", connection.id),
  ]);

  counts.people_created = Number(counts.people_created ?? 0);
  counts.people_updated = Number(counts.people_updated ?? 0);
  counts.companies_created = Number(counts.companies_created ?? 0);
  counts.companies_updated = Number(counts.companies_updated ?? 0);
  counts.candidates_created = Number(totalCandidates ?? counts.candidates_created ?? 0);
  counts.review_candidates_pending = Number(pendingCandidates ?? counts.review_candidates_pending ?? 0);
  counts.threads_discovered = Number(counts.threads_discovered ?? 0);
  counts.email_threads_processed = Number(counts.email_threads_processed ?? counts.threads_processed ?? 0);
  counts.warnings = Number(counts.warnings ?? 0);

  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const profileResp = await googleApiFetch(accessToken, "/gmail/v1/users/me/profile");
  const profile = profileResp.ok ? await profileResp.json() as { historyId?: string } : {};
  const { data: gmailState } = await admin
    .from("google_sync_states")
    .select("pending_history_id, committed_history_id, history_id")
    .eq("connection_id", connection.id)
    .eq("source", "gmail")
    .eq("resource_key", "default")
    .maybeSingle();

  const pendingHistory = gmailState?.pending_history_id
    ?? profile.historyId
    ?? sourceProgress.gmail?.history_id
    ?? gmailState?.history_id
    ?? null;

  await upsertSyncState(admin, connection, "gmail", "default", {
    history_id: pendingHistory,
    committed_history_id: pendingHistory,
    pending_history_id: null,
    initial_sync_completed: true,
    last_successful_sync_at: new Date().toISOString(),
    last_attempted_sync_at: new Date().toISOString(),
    last_incremental_completed_at: new Date().toISOString(),
    last_error: null,
    next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });

  sourceProgress.core = { completed: true };
  sourceProgress.gmail = {
    ...sourceProgress.gmail,
    processing_completed: true,
    core_metadata_completed: true,
    completed: true,
    history_id: pendingHistory,
  };

  await admin.from("google_import_runs").update({
    core_sync_status: "complete",
    enrichment_status: sourceProgress.enrichment?.paused ? "paused" : "running",
    progress_stage: "core_sync_complete",
    action_required: false,
    recovery_status: "idle",
    next_retry_at: null,
    retry_task_run_id: null,
    finalization_heartbeat_at: new Date().toISOString(),
    counts,
    source_progress: sourceProgress,
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", importRunId);

  await admin.from("user_google_connections").update({
    last_successful_sync_at: new Date().toISOString(),
    last_sync_error: null,
  }).eq("id", connection.id);

  if (usesCrmResolverV2(connection)) {
    try {
      const run = await ensureIncrementalResolverRun(admin, connection.id, connection.user_id);
      const resolverResult = await runResolverStage(admin, run.id);
      counts.crm_resolver_stage = resolverResult.stage;
      if (resolverResult.done) {
        bump(counts, "crm_resolver_completed");
      }
    } catch (resolverErr) {
      console.error("[google-sync] CRM resolver v2 step failed", (resolverErr as Error).message);
      bump(counts, "crm_resolver_errors");
    }
  }

  return {
    action: "complete_core_sync",
    done: true,
    counts,
    stage: "core_sync_complete",
    message: "Core CRM sync complete",
  };
}

async function batchFilterEnrichment(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  const enrichment = sourceProgress.enrichment ?? {};
  if (enrichment.paused) {
    return {
      action: "filter_enrichment_threads",
      done: true,
      counts,
      stage: "enrichment_complete",
      message: "Enrichment paused",
    };
  }

  const result = await batchFilterEnrichmentThreads(
    admin,
    connection,
    BATCH_LIMITS.enrichment_filter_threads,
    counts,
  );

  if (result.done) {
    sourceProgress.enrichment = { ...enrichment, filter_completed: true };
  }

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "filtering_relationship_threads",
    current_source: "enrichment",
    counts,
    source_progress: sourceProgress,
    enrichment_status: "running",
  });

  return {
    action: "filter_enrichment_threads",
    done: result.done,
    counts,
    stage: "filtering_relationship_threads",
    processed_in_batch: result.processed,
  };
}

async function batchGroupRelationships(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  const enrichment = sourceProgress.enrichment ?? {};
  if (enrichment.paused) {
    return { action: "group_relationships", done: true, counts, stage: "enrichment_complete" };
  }

  const result = await batchGroupRelationshipThreads(
    admin,
    connection,
    importRunId,
    BATCH_LIMITS.enrichment_group_threads,
    counts,
  );

  if (result.done) {
    sourceProgress.enrichment = { ...enrichment, grouping_completed: true };
  }

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "analyzing_relationships",
    current_source: "enrichment",
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "group_relationships",
    done: result.done,
    counts,
    stage: "analyzing_relationships",
    processed_in_batch: result.processed,
  };
}

async function batchEnrichRelationshipBatch(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
  runRow: Record<string, unknown>,
): Promise<BatchResult> {
  const enrichment = sourceProgress.enrichment ?? {};
  if (enrichment.paused) {
    return { action: "enrich_relationship_batch", done: true, counts, stage: "enrichment_complete" };
  }

  const costLimits = getImportCostLimits();
  const aiGroupsProcessed = Number(counts.relationship_groups_processed ?? 0);
  const costMetrics = (runRow.cost_metrics ?? {}) as Record<string, unknown>;
  const estimatedCost = Number(costMetrics.estimated_cost_usd ?? 0);

  if (aiGroupsProcessed >= costLimits.maxAiGroups || estimatedCost >= costLimits.maxAiCostUsd) {
    sourceProgress.enrichment = { ...enrichment, paused: true, completed: false };
    await admin.from("google_import_runs").update({
      enrichment_status: "paused",
      enrichment_paused_at: new Date().toISOString(),
      source_progress: sourceProgress,
      counts,
      warnings: ["Enrichment paused after reaching configured AI cost or group limits."],
    }).eq("id", importRunId);
    return {
      action: "enrich_relationship_batch",
      done: true,
      counts,
      stage: "enrichment_complete",
      message: "Enrichment paused at cost cap",
    };
  }

  const groups = await loadRelationshipGroupsForEnrichment(
    admin,
    connection.id,
    BATCH_LIMITS.enrichment_relationship_groups,
  );

  if (!groups.length) {
    sourceProgress.enrichment = { ...enrichment, completed: true };
    await persistBatchProgress(admin, importRunId, {
      progress_stage: "enrichment_complete",
      enrichment_status: "complete",
      counts,
      source_progress: sourceProgress,
    });
    return { action: "enrich_relationship_batch", done: true, counts, stage: "enrichment_complete" };
  }

  const accessToken = await getValidGoogleAccessToken(admin, connection);
  const settings = connection.import_settings as Record<string, unknown>;
  const includeContent = settings.include_gmail_content === true;

  for (const group of groups) {
    const subjects: string[] = [];
    const excerpts: string[] = [];

    for (const threadId of group.thread_ids.slice(0, 5)) {
      const threadResp = await googleApiFetch(
        accessToken,
        `/gmail/v1/users/me/threads/${threadId}?format=full`,
      );
      if (!threadResp.ok) continue;
      const threadData = await threadResp.json() as { messages?: Array<Record<string, unknown>> };
      const messages = (threadData.messages ?? []).slice(-3);
      for (const message of messages) {
        const parsed = parseGmailMessage(message, connection.google_email, includeContent);
        if (parsed.subject) subjects.push(parsed.subject);
        excerpts.push(parsed.bodyExcerpt ?? parsed.snippet ?? "");
      }
    }

    const contentHash = await sha256Hex(JSON.stringify({ subjects, excerpts, thread_ids: group.thread_ids }));
    if (group.content_hash && group.content_hash === contentHash) {
      await admin.from("google_relationship_groups").update({
        status: "skipped",
        content_hash: contentHash,
      }).eq("id", group.id);
      bump(counts, "threads_skipped_as_unchanged");
      continue;
    }

    const analysis = await analyzeRelationshipGroup({
      externalEmail: group.normalized_external_email,
      threadCount: group.thread_count,
      subjects,
      excerpts,
      trace: {
        connection_id: connection.id,
        group_id: group.id,
        thread_count: group.thread_count,
      },
    });

    await admin.from("google_relationship_groups").update({
      status: "enriched",
      content_hash: contentHash,
      ai_summary: analysis.summary,
      model_version: googleAnalysisModel(),
      prompt_version: PROMPT_VERSION,
      analysis_version: ANALYSIS_VERSION,
      last_enriched_at: new Date().toISOString(),
      metadata: {
        commercial_opportunity: analysis.commercial_opportunity,
        opportunity_signals: analysis.opportunity_signals,
        lead_candidate: analysis.lead_candidate,
      },
    }).eq("id", group.id);

    await admin.from("google_gmail_threads").update({
      enrichment_status: "enriched",
      processed_at: new Date().toISOString(),
      relevance_status: "processed",
      content_hash: contentHash,
      last_ai_processed_at: new Date().toISOString(),
    }).eq("relationship_group_id", group.id);

    if (analysis.commercial_opportunity && analysis.confidence >= 0.75) {
      bump(counts, "leads_detected");
      await admin.from("crm_entity_candidates").upsert(
        {
          owner_user_id: connection.user_id,
          connection_id: connection.id,
          entity_type: "lead",
          status: "pending",
          display_name: analysis.summary.slice(0, 120),
          email: group.normalized_external_email,
          company_name: analysis.detected_company_name,
          domain: analysis.detected_company_domain,
          confidence: analysis.confidence,
          evidence: { opportunity_signals: analysis.opportunity_signals, group_id: group.id },
          sources: ["gmail"],
          reason: analysis.summary,
        },
        { onConflict: "owner_user_id,entity_type,email", ignoreDuplicates: true },
      );
    }

    bump(counts, "relationship_groups_processed");
    bump(counts, "threads_used_for_ai", group.thread_count);
  }

  const { count: remaining } = await admin
    .from("google_relationship_groups")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .in("status", ["pending", "queued"]);

  const done = (remaining ?? 0) === 0;
  if (done) {
    sourceProgress.enrichment = { ...enrichment, completed: true };
  }

  await persistBatchProgress(admin, importRunId, {
    progress_stage: done ? "enrichment_complete" : "analyzing_relationships",
    current_source: "enrichment",
    progress_processed: counts.relationship_groups_processed ?? 0,
    progress_total: (counts.relationship_groups_queued ?? 0) || undefined,
    counts,
    source_progress: sourceProgress,
    enrichment_status: done ? "complete" : "running",
  });

  return {
    action: "enrich_relationship_batch",
    done,
    counts,
    stage: done ? "enrichment_complete" : "analyzing_relationships",
    processed_in_batch: groups.length,
  };
}

async function batchGmailProcess(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
  processorVersion = 2,
): Promise<BatchResult> {
  if (processorVersion >= 2) {
    sourceProgress.gmail = {
      ...sourceProgress.gmail,
      processing_completed: true,
      core_metadata_completed: true,
    };
    await persistBatchProgress(admin, importRunId, {
      progress_stage: "core_sync_complete",
      source_progress: sourceProgress,
      counts,
    });
    return {
      action: "gmail_process_batch",
      done: true,
      counts,
      stage: "core_sync_complete",
      message: "Legacy gmail processing skipped — enrichment pipeline handles AI",
    };
  }

  const settings = connection.import_settings as Record<string, unknown>;
  const includeContent = settings.include_gmail_content === true;

  const { data: pendingThreads } = await admin
    .from("google_gmail_threads")
    .select("id, thread_id, content_hash, subject, participant_emails, metadata")
    .eq("connection_id", connection.id)
    .eq("relevance_status", "relevant")
    .is("processed_at", null)
    .order("last_message_at", { ascending: false })
    .limit(BATCH_LIMITS.gmail_process_threads);

  if (!pendingThreads?.length) {
    sourceProgress.gmail = { ...sourceProgress.gmail, processing_completed: true, completed: true };
    const accessToken = await getValidGoogleAccessToken(admin, connection);
    const profileResp = await googleApiFetch(accessToken, "/gmail/v1/users/me/profile");
    const profile = profileResp.ok ? await profileResp.json() as { historyId?: string } : {};
    const { data: gmailState } = await admin
      .from("google_sync_states")
      .select("pending_history_id, committed_history_id")
      .eq("connection_id", connection.id)
      .eq("source", "gmail")
      .eq("resource_key", "default")
      .maybeSingle();
    const pendingHistory = gmailState?.pending_history_id ?? profile.historyId ?? sourceProgress.gmail?.history_id ?? null;
    await upsertSyncState(admin, connection, "gmail", "default", {
      history_id: pendingHistory,
      committed_history_id: pendingHistory,
      pending_history_id: null,
      initial_sync_completed: true,
      last_successful_sync_at: new Date().toISOString(),
      last_attempted_sync_at: new Date().toISOString(),
      last_incremental_completed_at: new Date().toISOString(),
      last_error: null,
      next_scheduled_sync_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    await persistBatchProgress(admin, importRunId, { source_progress: sourceProgress, counts, progress_stage: "processing_gmail_threads" });
    return { action: "gmail_process_batch", done: true, counts, stage: "processing_gmail_threads", source: "gmail" };
  }

  const accessToken = await getValidGoogleAccessToken(admin, connection);
  let processed = 0;

  const costLimits = getImportCostLimits();
  let aiThreadsThisRun = Number(counts.ai_threads_processed ?? 0);

  for (const row of pendingThreads) {
    const threadResp = await googleApiFetch(
      accessToken,
      `/gmail/v1/users/me/threads/${row.thread_id}?format=full`,
    );
    if (!threadResp.ok) {
      await admin.from("google_gmail_threads").update({ relevance_status: "failed", processed_at: new Date().toISOString() }).eq("id", row.id);
      continue;
    }
    const threadData = await threadResp.json() as {
      messages?: Array<Record<string, unknown>>;
    };
    const messages = threadData.messages ?? [];
    const recentMessages = messages.slice(-3);
    const messageIds = recentMessages.map((m) => String(m.id ?? "")).filter(Boolean);
    const latestInternalDate = String(recentMessages[recentMessages.length - 1]?.internalDate ?? "");
    const participants = (row.participant_emails as string[]) ?? [];
    const contentHash = await computeGmailThreadFingerprint({
      threadId: row.thread_id,
      subject: row.subject ?? null,
      participants,
      messageIds,
      latestInternalDate: latestInternalDate || null,
    });

    if (row.content_hash && row.content_hash === contentHash) {
      await admin.from("google_gmail_threads").update({
        relevance_status: "processed",
        processed_at: new Date().toISOString(),
        last_processed_at: new Date().toISOString(),
      }).eq("id", row.id);
      bump(counts, "threads_skipped_unchanged");
      processed++;
      continue;
    }

    if (aiThreadsThisRun >= costLimits.maxAiGroups) {
      continue;
    }

    for (const message of recentMessages) {
      const parsed = parseGmailMessage(message, connection.google_email, includeContent);
      if (isAutomatedSender(parsed.fromEmail)) continue;
      const messageParticipants = collectParticipantEmails(parsed);
      if (!messageParticipants.some((e) => !isInternalOxusEmail(e))) continue;
      await processGmailMessage(admin, connection, accessToken, parsed.messageId, includeContent, counts, parsed);
      aiThreadsThisRun++;
      bump(counts, "ai_threads_processed");
    }

    await admin.from("google_gmail_threads").update({
      relevance_status: "processed",
      processed_at: new Date().toISOString(),
      content_hash: contentHash,
      last_processed_at: new Date().toISOString(),
      last_ai_processed_at: new Date().toISOString(),
    }).eq("id", row.id);
    bump(counts, "email_threads_processed");
    processed++;
  }

  const { count: remaining } = await admin
    .from("google_gmail_threads")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .eq("relevance_status", "relevant")
    .is("processed_at", null);

  const done = (remaining ?? 0) === 0;
  if (done) {
    sourceProgress.gmail = { ...sourceProgress.gmail, processing_completed: true, completed: true };
  }

  await persistBatchProgress(admin, importRunId, {
    progress_stage: "processing_gmail_threads",
    current_source: "gmail",
    progress_processed: counts.email_threads_processed ?? 0,
    progress_total: (counts.email_threads_processed ?? 0) + (remaining ?? 0),
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "gmail_process_batch",
    done,
    counts,
    stage: "processing_gmail_threads",
    source: "gmail",
    processed_in_batch: processed,
  };
}

async function batchResolveEntities(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  if (usesCrmResolverV2(connection)) {
    sourceProgress.resolve = { completed: true };
    await persistBatchProgress(admin, importRunId, {
      progress_stage: "resolving_companies",
      source_progress: sourceProgress,
      counts,
    });
    return {
      action: "resolve_entities",
      done: true,
      counts,
      stage: "resolving_companies",
      message: "Skipped — CRM resolver v2 handles entity resolution",
      processed_in_batch: 0,
    };
  }
  const { data: interactions } = await admin
    .from("google_interactions")
    .select("id, external_id, participant_emails, attendee_emails, interaction_type, metadata, subject, occurred_at, organizer_email")
    .eq("connection_id", connection.id)
    .is("processed_at", null)
    .limit(BATCH_LIMITS.resolve_entities);

  if (!interactions?.length) {
    sourceProgress.resolve = { completed: true };
    await persistBatchProgress(admin, importRunId, {
      progress_stage: "resolving_companies",
      source_progress: sourceProgress,
      counts,
    });
    return { action: "resolve_entities", done: true, counts, stage: "resolving_companies" };
  }

  for (const row of interactions) {
    try {
      const { companyId, personIds } = await processGoogleInteractionRow(admin, connection, {
        id: row.id,
        external_id: row.external_id,
        interaction_type: row.interaction_type,
        participant_emails: row.participant_emails as string[],
        attendee_emails: row.attendee_emails as string[] | undefined,
        subject: row.subject,
        occurred_at: row.occurred_at,
        metadata: row.metadata as Record<string, unknown>,
        organizer_email: row.organizer_email,
      }, counts);

      await admin.from("google_interactions").update({
        processed_at: new Date().toISOString(),
        company_id: companyId,
        person_ids: personIds,
      }).eq("id", row.id);
    } catch {
      bump(counts, "processing_errors");
      await admin.from("google_interactions").update({
        processed_at: new Date().toISOString(),
        metadata: { ...(row.metadata as object ?? {}), resolution_error: true },
      }).eq("id", row.id);
    }
  }

  const { count: remaining } = await admin
    .from("google_interactions")
    .select("id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .is("processed_at", null);

  const done = (remaining ?? 0) === 0;
  if (done) sourceProgress.resolve = { completed: true };

  await persistBatchProgress(admin, importRunId, {
    progress_stage: done ? "resolving_companies" : "resolving_people",
    current_source: "entities",
    progress_processed: (counts.people_created ?? 0) + (counts.people_updated ?? 0),
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "resolve_entities",
    done,
    counts,
    stage: done ? "resolving_companies" : "resolving_people",
    processed_in_batch: interactions.length,
  };
}

async function batchEnrichCompanies(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  const enrichProgress = sourceProgress.enrich ?? { queued_ids: [] };
  const queued = new Set(enrichProgress.queued_ids ?? []);

  const { data: companies } = await admin
    .from("clients")
    .select("id, website, primary_domain, enrichment_status")
    .eq("relationship_owner_id", connection.user_id)
    .in("enrichment_status", ["not_started", "pending"])
    .not("website", "is", null)
    .limit(BATCH_LIMITS.enrich_companies);

  let queuedCount = 0;
  if (shouldQueueTriggerDevTasks() && companies?.length) {
    for (const company of companies) {
      if (queued.has(company.id)) continue;
      await triggerDevTask("crm-enrich-company", {
        company_id: company.id,
        user_id: connection.user_id,
        website: company.website ?? company.primary_domain,
      }, { idempotencyKey: `enrich:${company.id}:${importRunId}` });
      queued.add(company.id);
      queuedCount++;
      bump(counts, "companies_enqueued");
    }
  }

  sourceProgress.enrich = { completed: true, queued_ids: [...queued] };
  await persistBatchProgress(admin, importRunId, {
    progress_stage: "enriching_companies",
    current_source: "enrichment",
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "enrich_companies",
    done: true,
    counts,
    stage: "enriching_companies",
    processed_in_batch: queuedCount,
  };
}

async function batchReconcileReset(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
): Promise<BatchResult> {
  const { error } = await admin
    .from("google_interactions")
    .update({ processed_at: null, company_id: null, person_ids: [] })
    .eq("connection_id", connection.id);
  if (error) bump(counts, "processing_errors");

  sourceProgress.resolve = { completed: false };
  await persistBatchProgress(admin, importRunId, {
    progress_stage: "resolving_entities",
    current_source: "reconcile",
    counts,
    source_progress: sourceProgress,
  });

  return {
    action: "reconcile_reset",
    done: true,
    counts,
    stage: "resolving_entities",
    message: "Cleared interaction processing flags for reconciliation",
  };
}

async function batchFinalize(
  admin: SupabaseClient,
  importRunId: string,
  connection: GoogleConnectionRow,
  counts: SyncCounts,
  sourceProgress: SourceProgress,
  sources: string[],
): Promise<BatchResult> {
  await persistBatchProgress(admin, importRunId, { progress_stage: "finalizing", counts });

  const warnings: string[] = [];
  if ((counts.contacts_deferred ?? 0) > 0) {
    warnings.push(`${counts.contacts_deferred} contacts processed in entity resolution`);
  }
  const gmailEnabled = !!(connection.sources_enabled as Record<string, boolean>)?.gmail;
  const gmailScope = (connection.granted_scopes ?? []).includes("https://www.googleapis.com/auth/gmail.readonly");
  if (!gmailEnabled || !gmailScope) {
    warnings.push("Gmail conversations were not analyzed because Gmail access is not enabled.");
  }
  if (!sourceProgress.resolve?.completed) {
    warnings.push("Entity resolution did not fully complete.");
  }

  const partialFailures = sources.filter((s) => {
    if (s === "contacts") return !sourceProgress.contacts?.completed;
    if (s === "calendar") return !sourceProgress.calendar?.completed;
    if (s === "gmail") return !sourceProgress.gmail?.completed;
    return false;
  });

  const finalStatus = partialFailures.length > 0 || warnings.length > 0
    ? "completed_with_warnings"
    : "completed";

  const enrichmentDone = sourceProgress.enrichment?.completed !== false;
  const enrichmentStatus = enrichmentDone ? "complete" : "completed_with_warnings";

  if (partialFailures.length > 0) {
    warnings.push(`Incomplete sources: ${partialFailures.join(", ")}`);
  }

  await admin.from("google_import_runs").update({
    status: finalStatus,
    core_sync_status: "complete",
    enrichment_status: enrichmentStatus,
    progress_stage: finalStatus,
    progress_percentage: 100,
    counts,
    warnings,
    completed_at: new Date().toISOString(),
    error: null,
    error_code: null,
    last_heartbeat_at: new Date().toISOString(),
    source_progress: sourceProgress,
  }).eq("id", importRunId);

  await admin.from("user_google_connections").update({
    last_successful_sync_at: new Date().toISOString(),
    last_sync_error: null,
  }).eq("id", connection.id);

  const { data: gmailState } = await admin
    .from("google_sync_states")
    .select("pending_history_id")
    .eq("connection_id", connection.id)
    .eq("source", "gmail")
    .eq("resource_key", "default")
    .maybeSingle();
  if (gmailState?.pending_history_id) {
    await upsertSyncState(admin, connection, "gmail", "default", {
      committed_history_id: gmailState.pending_history_id,
      history_id: gmailState.pending_history_id,
      pending_history_id: null,
      last_incremental_completed_at: new Date().toISOString(),
    });
  }

  return { action: "finalize", done: true, counts, stage: finalStatus, message: "Import finalized" };
}

export async function runGoogleImportBatch(
  admin: SupabaseClient,
  importRunId: string,
  action: GoogleSyncBatchAction,
  context?: RunContext,
): Promise<BatchResult> {
  const ctx = context ?? {};
  try {
    if (action === "validate") {
      return await batchValidate(admin, importRunId, ctx);
    }

    const { connection, counts, sourceProgress, sources, run, processorVersion } = await loadImportContext(admin, importRunId);

    switch (action) {
      case "contacts_page":
        return await batchContactsPage(admin, importRunId, connection, counts, sourceProgress);
      case "calendar_page":
        return await batchCalendarPage(admin, importRunId, connection, counts, sourceProgress);
      case "gmail_discover_page":
        return await batchGmailDiscoverPage(admin, importRunId, connection, counts, sourceProgress, run.run_type as string);
      case "resolve_basic_entities":
        return await batchResolveBasicEntities(admin, importRunId, connection, counts, sourceProgress);
      case "complete_core_sync":
        return await batchCompleteCoreSync(admin, importRunId, connection, counts, sourceProgress);
      case "filter_enrichment_threads":
        return await batchFilterEnrichment(admin, importRunId, connection, counts, sourceProgress);
      case "group_relationships":
        return await batchGroupRelationships(admin, importRunId, connection, counts, sourceProgress);
      case "enrich_relationship_batch":
        return await batchEnrichRelationshipBatch(admin, importRunId, connection, counts, sourceProgress, run);
      case "gmail_process_batch":
        return await batchGmailProcess(admin, importRunId, connection, counts, sourceProgress, processorVersion);
      case "resolve_entities":
        return await batchResolveEntities(admin, importRunId, connection, counts, sourceProgress);
      case "reconcile_reset":
        return await batchReconcileReset(admin, importRunId, connection, counts, sourceProgress);
      case "enrich_companies":
        return await batchEnrichCompanies(admin, importRunId, connection, counts, sourceProgress);
      case "finalize":
        return await batchFinalize(admin, importRunId, connection, counts, sourceProgress, sources);
      default:
        throw new GoogleSyncError("INVALID_WORKER_PAYLOAD", `Unknown batch action: ${action}`);
    }
  } catch (e) {
    const syncError = e instanceof GoogleSyncError
      ? e
      : new GoogleSyncError("SYNC_FAILED", (e as Error).message || "Synchronization failed.");
    const now = new Date().toISOString();
    const { classifyGoogleSyncError } = await import("./googleImportRecovery.ts");
    const classification = classifyGoogleSyncError(syncError.code, syncError.message);

    if (classification === "recoverable") {
      const { data: current } = await admin
        .from("google_import_runs")
        .select("retry_count, import_history, progress_stage")
        .eq("id", importRunId)
        .maybeSingle();
      const retryCount = Number(current?.retry_count ?? 0) + 1;
      const history = Array.isArray(current?.import_history) ? [...current.import_history] : [];
      history.push({
        at: now,
        event: "retry_scheduled",
        detail: `${action}: ${syncError.code}`,
      });
      await admin.from("google_import_runs").update({
        status: "running",
        progress_stage: action === "complete_core_sync" ? "completing_core_sync" : (current?.progress_stage ?? "running"),
        ...(action === "complete_core_sync" ? { core_sync_status: "running" } : {}),
        failed_stage: action,
        error: syncError.message.slice(0, 500),
        error_code: syncError.code,
        action_required: false,
        recovery_status: "retrying",
        retry_count: retryCount,
        ...(action === "complete_core_sync" ? { finalization_heartbeat_at: now } : {}),
        last_historical_error_code: syncError.code,
        last_historical_error_message: syncError.message.slice(0, 500),
        import_history: history,
        last_heartbeat_at: now,
      }).eq("id", importRunId);
    } else {
      await admin.from("google_import_runs").update({
        status: "failed",
        progress_stage: "failed",
        failed_stage: action,
        error: syncError.message.slice(0, 500),
        error_code: syncError.code,
        action_required: true,
        recovery_status: "needs_attention",
        failed_at: now,
        completed_at: now,
        last_heartbeat_at: now,
      }).eq("id", importRunId);
    }
    throw syncError;
  }
}

export async function queueGoogleImport(
  admin: SupabaseClient,
  importRunId: string,
  connectionId: string,
  userId: string,
  options?: {
    connectionGeneration?: number | null;
    operationIdentity?: string | null;
    syncMode?: string | null;
  },
) {
  const { data: runRowFull } = await admin
    .from("google_import_runs")
    .select("run_type, correlation_id, connection_generation, operation_identity, trigger_run_id, dispatch_status")
    .eq("id", importRunId)
    .maybeSingle();

  if (runRowFull?.trigger_run_id && runRowFull.dispatch_status === "dispatched") {
    return { queued: true, trigger_run_id: runRowFull.trigger_run_id as string, already_dispatched: true };
  }

  if (!shouldQueueTriggerDevTasks()) {
    throw new GoogleSyncError("TRIGGER_NOT_CONFIGURED", "Background sync requires Trigger.dev in production.");
  }

  const runType = options?.syncMode ?? runRowFull?.run_type ?? "initial";
  const taskId = runType === "incremental" || runType === "incremental_sync" || runType === "checkpoint_recovery"
    ? "google-incremental-sync"
    : "google-initial-import";
  const generation = options?.connectionGeneration ?? runRowFull?.connection_generation ?? 0;
  const operationIdentity = options?.operationIdentity
    ?? runRowFull?.operation_identity
    ?? `google-import:${connectionId}:${importRunId}:generation:${generation}`;

  const result = await triggerDevTask(taskId, {
    import_run_id: importRunId,
    connection_id: connectionId,
    user_id: userId,
    correlation_id: runRowFull?.correlation_id ?? crypto.randomUUID(),
    connection_generation: generation,
  }, { idempotencyKey: operationIdentity });

  await admin.from("google_import_runs").update({
    trigger_run_id: result.id,
    dispatch_status: "dispatched",
    status: "starting",
    progress_stage: "queued",
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", importRunId);

  console.info("[queueGoogleImport]", JSON.stringify({
    event: "google_sync_dispatched",
    import_run_id: importRunId,
    connection_id: connectionId,
    connection_generation: generation,
    trigger_run_id: result.id,
    task_id: taskId,
    operation_identity: operationIdentity,
  }));

  return { queued: true, trigger_run_id: result.id, already_dispatched: false };
}
