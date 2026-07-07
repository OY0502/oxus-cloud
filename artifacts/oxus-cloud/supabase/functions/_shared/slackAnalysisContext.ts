/** Build compact Slack context for PM status report analysis. */

export type SlackEventForAnalysis = {
  id: string;
  slack_channel_id: string;
  slack_ts: string;
  slack_thread_ts: string | null;
  message_preview: string | null;
  message_text: string | null;
  signal_type: string | null;
  signal_confidence: number | null;
  link_type: string | null;
  is_client_facing: boolean;
  include_in_client_updates: boolean;
  slack_user_name: string | null;
  created_at: string;
  channel_name?: string | null;
};

export function buildSlackThreadGroups(events: SlackEventForAnalysis[]) {
  const groups = new Map<string, SlackEventForAnalysis[]>();
  for (const event of events) {
    const threadKey = event.slack_thread_ts ?? event.slack_ts;
    const key = `${event.slack_channel_id}:${threadKey}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, items]) => {
    const sorted = items.sort((a, b) => Number(a.slack_ts) - Number(b.slack_ts));
    const latest = sorted[sorted.length - 1];
    const hasResolved = sorted.some((e) => e.signal_type === "resolved");
    const meaningful = sorted.filter((e) => e.signal_type && e.signal_type !== "noise");
    return {
      thread_key: key,
      channel_id: latest.slack_channel_id,
      channel_name: latest.channel_name ?? null,
      link_type: latest.link_type,
      is_client_facing: latest.is_client_facing,
      net_state: hasResolved ? "resolved_thread" : meaningful.length > 0 ? "open_thread" : "informational",
      messages: sorted.map((e) => ({
        id: e.id,
        ts: e.slack_ts,
        preview: e.message_preview ?? e.message_text?.slice(0, 200) ?? null,
        signal_type: e.signal_type,
        actor: e.slack_user_name,
      })),
    };
  });
}

export function buildSlackAnalysisText(events: SlackEventForAnalysis[]): string {
  const meaningful = events.filter((e) => e.signal_type && e.signal_type !== "noise");
  if (meaningful.length === 0) return "No meaningful Slack signals in this period.";
  const groups = buildSlackThreadGroups(meaningful);
  return groups
    .map((group) =>
      [
        `Thread: ${group.thread_key}`,
        group.channel_name ? `Channel: ${group.channel_name}` : `Channel ID: ${group.channel_id}`,
        `Link type: ${group.link_type ?? "unknown"}`,
        `Net state: ${group.net_state}`,
        `Messages: ${JSON.stringify(group.messages)}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

export function buildClientFacingSlackText(events: SlackEventForAnalysis[]): string {
  const clientEvents = events.filter(
    (e) =>
      e.include_in_client_updates &&
      e.signal_type &&
      e.signal_type !== "noise" &&
      e.signal_type !== "resolved",
  );
  if (clientEvents.length === 0) return "";
  return clientEvents
    .slice(0, 20)
    .map((e) => `[${e.link_type ?? "external"}] ${e.message_preview ?? e.message_text?.slice(0, 200) ?? ""}`)
    .join("\n");
}
