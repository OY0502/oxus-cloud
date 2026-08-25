import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chunkKnowledgeText } from "./knowledgeChunking.ts";
import { classifySlackMessageText } from "./slackSignalClassification.ts";
import { buildSlackThreadKey, slackTsToIso } from "./projectSignalPipeline.ts";

type SlackMemoryEvent = {
  id: string;
  project_id: string;
  project_slack_link_id: string | null;
  slack_team_id: string;
  slack_channel_id: string;
  slack_ts: string;
  slack_thread_ts: string | null;
  slack_user_id: string | null;
  slack_user_name: string | null;
  message_text: string | null;
  message_preview: string | null;
  signal_type: string | null;
  signal_confidence: number | null;
  actor_classification: string | null;
  link_type: string | null;
  is_client_facing: boolean;
  include_in_ai: boolean;
};

type SlackMemoryLink = {
  id: string;
  channel_name: string | null;
  link_label: string | null;
  link_type: string;
  is_client_facing: boolean;
  include_in_ai: boolean;
};

export type SlackKnowledgeSyncResult = {
  threads_checked: number;
  sources_created: number;
  sources_updated: number;
  sources_unchanged: number;
  sources_skipped: number;
  source_ids: string[];
};

const SECTION_BY_SIGNAL: Record<string, string> = {
  decision: "Decisions",
  client_question: "Questions and clarifications",
  scope_change: "Requirements and scope",
  blocker: "Risks and blockers",
  access_needed: "Risks and blockers",
  general_action: "Actions and follow-ups",
  meeting_needed: "Actions and follow-ups",
  progress_update: "Progress and delivery updates",
  resolved: "Resolved points",
  noise: "Supporting conversation",
};

function slackPermalink(channelId: string, ts: string): string {
  return `https://slack.com/archives/${encodeURIComponent(channelId)}/p${ts.replace(/\D/g, "")}`;
}

function cleanMessageText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<@([A-Z0-9]+)>/gi, "@$1")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function eventSignal(event: SlackMemoryEvent): string {
  return event.signal_type || classifySlackMessageText(cleanMessageText(event.message_text)).signal_type;
}

function eventLine(event: SlackMemoryEvent): string {
  const occurredAt = slackTsToIso(event.slack_ts);
  const date = occurredAt ? occurredAt.slice(0, 16).replace("T", " ") + " UTC" : event.slack_ts;
  const actor = event.slack_user_name?.trim() || event.slack_user_id?.trim() || "Unknown participant";
  const actorType = event.actor_classification && event.actor_classification !== "unknown"
    ? `, ${event.actor_classification}`
    : "";
  return `- [${date}] ${actor}${actorType}: ${cleanMessageText(event.message_text ?? event.message_preview).slice(0, 1600)}`;
}

function titleForThread(events: SlackMemoryEvent[]): string {
  for (const event of events) {
    const text = cleanMessageText(event.message_text ?? event.message_preview);
    if (!text) continue;
    const classified = classifySlackMessageText(text);
    if (classified.signal_type !== "noise" && classified.title.trim()) return classified.title.trim().slice(0, 120);
  }
  const fallback = cleanMessageText(events[0]?.message_text ?? events[0]?.message_preview);
  return (fallback || "Slack conversation").slice(0, 120);
}

export function buildSlackThreadMemory(args: {
  events: SlackMemoryEvent[];
  link?: SlackMemoryLink;
}): { title: string; text: string; metadata: Record<string, unknown> } | null {
  const events = args.events
    .filter((event) => event.include_in_ai !== false && cleanMessageText(event.message_text ?? event.message_preview))
    .sort((a, b) => Number(a.slack_ts) - Number(b.slack_ts))
    .slice(-80);
  if (events.length === 0) return null;

  const meaningful = events.filter((event) => eventSignal(event) !== "noise");
  const external = args.link?.link_type === "external" || args.link?.is_client_facing === true;
  if (meaningful.length === 0 && (!external || events.length < 2)) return null;

  const first = events[0];
  const last = events[events.length - 1];
  const threadTs = first.slack_thread_ts || first.slack_ts;
  const threadKey = buildSlackThreadKey(first.slack_team_id, first.slack_channel_id, threadTs, first.slack_ts);
  const permalink = slackPermalink(first.slack_channel_id, threadTs);
  const title = titleForThread(events);
  const channel = args.link?.channel_name || first.slack_channel_id;
  const participants = [...new Set(events.map((event) =>
    event.slack_user_name?.trim() || event.slack_user_id?.trim() || "Unknown participant"
  ))];
  const signalTypes = [...new Set(events.map(eventSignal).filter((type) => type !== "noise"))];
  const sections = new Map<string, string[]>();
  for (const event of events) {
    const section = SECTION_BY_SIGNAL[eventSignal(event)] || "Supporting conversation";
    const lines = sections.get(section) ?? [];
    lines.push(eventLine(event));
    sections.set(section, lines);
  }

  const preferredOrder = [
    "Decisions",
    "Questions and clarifications",
    "Requirements and scope",
    "Risks and blockers",
    "Actions and follow-ups",
    "Progress and delivery updates",
    "Resolved points",
    "Supporting conversation",
  ];
  const sectionText = preferredOrder.flatMap((section) => {
    const lines = sections.get(section);
    return lines?.length ? [`## ${section}\n${lines.join("\n")}`] : [];
  });
  const firstAt = slackTsToIso(first.slack_ts);
  const latestAt = slackTsToIso(last.slack_ts);
  const state = eventSignal(last) === "resolved" ? "resolved" : meaningful.length ? "active" : "context";
  const text = [
    `# ${title}`,
    `Channel: #${channel}`,
    `Channel type: ${external ? "external / client-facing" : args.link?.link_type || "unknown"}`,
    `Thread state: ${state}`,
    `Period: ${firstAt ?? first.slack_ts} → ${latestAt ?? last.slack_ts}`,
    `Participants: ${participants.join(", ")}`,
    `Slack source: ${permalink}`,
    ...sectionText,
  ].join("\n\n").slice(0, 60_000);

  return {
    title: `Slack #${channel} · ${title}`,
    text,
    metadata: {
      memory_kind: "slack_thread",
      slack_thread_key: threadKey,
      slack_team_id: first.slack_team_id,
      slack_channel_id: first.slack_channel_id,
      slack_thread_ts: threadTs,
      channel_name: channel,
      link_type: args.link?.link_type ?? first.link_type,
      is_client_facing: external,
      participants,
      signal_types: signalTypes,
      thread_state: state,
      first_message_at: firstAt,
      latest_message_at: latestAt,
      message_count: events.length,
      meaningful_message_count: meaningful.length,
      canonical_url: permalink,
    },
  };
}

export async function syncSlackThreadKnowledge(args: {
  admin: SupabaseClient;
  projectId: string;
  projectSlackLinkId?: string;
  threadKeys?: string[];
  limit?: number;
}): Promise<SlackKnowledgeSyncResult> {
  const result: SlackKnowledgeSyncResult = {
    threads_checked: 0,
    sources_created: 0,
    sources_updated: 0,
    sources_unchanged: 0,
    sources_skipped: 0,
    source_ids: [],
  };
  let linksQuery = args.admin
    .from("project_slack_links")
    .select("id, channel_name, link_label, link_type, is_client_facing, include_in_ai")
    .eq("project_id", args.projectId)
    .eq("status", "active")
    .eq("include_in_ai", true);
  if (args.projectSlackLinkId) linksQuery = linksQuery.eq("id", args.projectSlackLinkId);
  const { data: links, error: linksError } = await linksQuery;
  if (linksError) throw new Error(linksError.message);
  const linkById = new Map((links ?? []).map((link) => [String(link.id), link as SlackMemoryLink]));
  if (linkById.size === 0) return result;

  let eventsQuery = args.admin
    .from("project_slack_events")
    .select("id, project_id, project_slack_link_id, slack_team_id, slack_channel_id, slack_ts, slack_thread_ts, slack_user_id, slack_user_name, message_text, message_preview, signal_type, signal_confidence, actor_classification, link_type, is_client_facing, include_in_ai")
    .eq("project_id", args.projectId)
    .eq("include_in_ai", true)
    .order("slack_ts", { ascending: false })
    .limit(Math.min(Math.max(args.limit ?? 1000, 50), 2000));
  if (args.projectSlackLinkId) eventsQuery = eventsQuery.eq("project_slack_link_id", args.projectSlackLinkId);
  const requestedRoots = args.threadKeys?.length
    ? [...new Set(args.threadKeys.map((key) => key.split(":").at(-1) ?? "").filter((value) => /^\d+\.\d+$/.test(value)))]
    : [];
  if (requestedRoots.length > 0) eventsQuery = eventsQuery.in("slack_thread_ts", requestedRoots.slice(0, 500));
  const { data: rows, error: eventsError } = await eventsQuery;
  if (eventsError) throw new Error(eventsError.message);

  const requestedKeys = args.threadKeys?.length ? new Set(args.threadKeys) : null;
  const groups = new Map<string, SlackMemoryEvent[]>();
  for (const row of (rows ?? []) as SlackMemoryEvent[]) {
    if (!row.project_slack_link_id || !linkById.has(row.project_slack_link_id)) continue;
    const key = buildSlackThreadKey(row.slack_team_id, row.slack_channel_id, row.slack_thread_ts, row.slack_ts);
    if (requestedKeys && !requestedKeys.has(key)) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const [threadKey, events] of groups) {
    result.threads_checked++;
    const link = linkById.get(String(events[0]?.project_slack_link_id));
    const memory = buildSlackThreadMemory({ events, link });
    if (!memory) {
      result.sources_skipped++;
      continue;
    }
    const externalId = threadKey;
    const { data: existing, error: existingError } = await args.admin
      .from("project_knowledge_sources")
      .select("id, source_text")
      .eq("project_id", args.projectId)
      .eq("external_provider", "slack")
      .eq("external_id", externalId)
      .eq("source_type", "slack_summary")
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.id && existing.source_text === memory.text) {
      await args.admin.from("project_knowledge_sources")
        .update({ last_synced_at: new Date().toISOString(), metadata: memory.metadata })
        .eq("id", existing.id);
      result.sources_unchanged++;
      result.source_ids.push(String(existing.id));
      continue;
    }

    let sourceId: string;
    if (existing?.id) {
      const { error } = await args.admin.from("project_knowledge_sources").update({
        source_title: memory.title,
        source_text: memory.text,
        source_preview: memory.text.slice(0, 1000),
        char_count: memory.text.length,
        metadata: memory.metadata,
        sync_status: "active",
        last_synced_at: new Date().toISOString(),
      }).eq("id", existing.id);
      if (error) throw new Error(error.message);
      sourceId = String(existing.id);
      result.sources_updated++;
    } else {
      const { data: created, error } = await args.admin.from("project_knowledge_sources").insert({
        project_id: args.projectId,
        source_type: "slack_summary",
        source_title: memory.title,
        input_method: "api",
        char_count: memory.text.length,
        source_text: memory.text,
        source_preview: memory.text.slice(0, 1000),
        external_provider: "slack",
        external_id: externalId,
        metadata: memory.metadata,
        sync_status: "active",
        last_synced_at: new Date().toISOString(),
      }).select("id").single();
      if (error || !created) throw new Error(error?.message ?? "Could not create Slack memory source.");
      sourceId = String(created.id);
      result.sources_created++;
    }

    await args.admin.from("project_knowledge_chunks").delete().eq("source_id", sourceId);
    const chunks = chunkKnowledgeText(memory.text, { targetChars: 2200, overlapChars: 180 });
    if (chunks.length > 0) {
      const { error: chunksError } = await args.admin.from("project_knowledge_chunks").insert(
        chunks.map((chunk, index) => ({
          project_id: args.projectId,
          source_id: sourceId,
          chunk_index: index,
          content: chunk.content,
          section_path: chunk.sectionPath,
          category: "slack_summary",
          metadata: {
            ...memory.metadata,
            source_type: "slack_summary",
            source_title: memory.title,
            section_path: chunk.sectionPath,
            char_start: chunk.charStart,
            char_end: chunk.charEnd,
            token_estimate: chunk.tokenEstimate,
          },
        })),
      );
      if (chunksError) throw new Error(chunksError.message);
    }
    result.source_ids.push(sourceId);
  }
  return result;
}
