/** Match proposed PM actions against existing items; suppress dismissed duplicates. */

import { normalizeSlug } from "./pmActionDedupe.ts";
import {
  actionFamiliesEquivalent,
  inferActionFamilyFromText,
  parseSlackActionIdentity,
  threadFamilyKeyFromIdentity,
  threadFamilyKeyFromSlackContext,
} from "./pmActionIdentity.ts";

export type ProposedPmAction = {
  action_key?: string | null;
  action_identity?: string | null;
  source_thread_key?: string | null;
  source_type?: string | null;
  signal_type?: string | null;
  action_type?: string | null;
  category?: string | null;
  title?: string | null;
  source_message?: string | null;
  source_event_ids?: string[];
  source_signal_ids?: string[];
  action_payload?: Record<string, unknown> | null;
  signal_at?: string;
  is_escalation?: boolean;
};

export type ExistingActionMatchKind = "open" | "dismissed" | "done" | "skipped" | "none";

export type ExistingActionMatch = {
  kind: ExistingActionMatchKind;
  item: Record<string, unknown> | null;
  shouldSuppress: boolean;
  shouldUpdate: boolean;
  shouldReopen: boolean;
  suppressionReason?: string;
};

export type SuppressionReason = {
  action_key: string | null;
  reason: string;
  dismissed_action_id: string;
  thread_key?: string | null;
  title?: string | null;
  dismissed_at?: string | null;
  signal_type?: string | null;
};

export function buildSlackMeetingActionKey(
  projectId: string,
  channelId: string,
  threadRootTs: string,
): string {
  return `slack_meeting:${projectId}:${channelId}:${threadRootTs}`;
}

export function slackThreadRootFromKey(threadKey: string): { channelId: string; rootTs: string } | null {
  const match = threadKey.match(/^slack:[^:]+:([^:]+):(.+)$/);
  if (!match) return null;
  return { channelId: match[1], rootTs: match[2] };
}

export function isActionDismissedOrSkipped(item: Record<string, unknown>): boolean {
  if (item.status === "dismissed") return true;
  if (item.execution_status === "skipped") return true;
  if (item.resolution_source === "dismissed") return true;
  return false;
}

function isSuppressionExpired(item: Record<string, unknown>): boolean {
  const expires = item.suppression_expires_at as string | null | undefined;
  if (!expires) return false;
  return new Date(expires).getTime() < Date.now();
}

function normalizedTitleKey(title: string | null | undefined): string | null {
  if (!title?.trim()) return null;
  const slug = normalizeSlug(title, "");
  return slug || null;
}

function payloadThreadMatch(
  proposed: Record<string, unknown>,
  itemPayload: Record<string, unknown>,
): boolean {
  const threadKey = proposed.slack_thread_key;
  if (typeof threadKey === "string" && threadKey === itemPayload.slack_thread_key) return true;

  const channelId = proposed.slack_channel_id;
  const threadTs = proposed.slack_thread_ts;
  if (
    typeof channelId === "string" &&
    typeof threadTs === "string" &&
    channelId === itemPayload.slack_channel_id &&
    threadTs === itemPayload.slack_thread_ts
  ) {
    return true;
  }
  return false;
}

function sameSignalTypeFamily(proposed: ProposedPmAction, item: Record<string, unknown>): boolean {
  const itemPayload = (item.action_payload ?? {}) as Record<string, unknown>;
  const itemSignalType = itemPayload.signal_type;

  if (proposed.signal_type && itemSignalType === proposed.signal_type) return true;
  if (proposed.signal_type === "meeting_needed" || itemSignalType === "meeting_needed") {
    return true;
  }
  if (proposed.action_type && item.action_type === proposed.action_type) return true;
  return false;
}

export function actionFamilyFromItem(item: Record<string, unknown>): string | null {
  const metadata = (item.source_metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.action_family === "string" && metadata.action_family.trim()) {
    return metadata.action_family;
  }
  const payload = (item.action_payload ?? {}) as Record<string, unknown>;
  if (typeof payload.action_family === "string" && payload.action_family.trim()) {
    return payload.action_family;
  }
  const parsed = parseSlackActionIdentity(item.action_identity as string | undefined);
  if (parsed?.actionFamily) return parsed.actionFamily;
  const sourceMessage =
    (typeof item.source_message === "string" ? item.source_message : null) ??
    (typeof item.last_signal_summary === "string" ? item.last_signal_summary : null) ??
    (typeof item.title === "string" ? item.title : "");
  if (sourceMessage.trim()) return inferActionFamilyFromText(sourceMessage);
  return null;
}

export function actionFamilyFromProposed(proposed: ProposedPmAction): string | null {
  const payload = (proposed.action_payload ?? {}) as Record<string, unknown>;
  if (typeof payload.action_family === "string" && payload.action_family.trim()) {
    return payload.action_family;
  }
  const parsed = parseSlackActionIdentity(proposed.action_identity ?? undefined);
  if (parsed?.actionFamily) return parsed.actionFamily;
  const parsedPayload = parseSlackActionIdentity(payload.action_identity as string | undefined);
  if (parsedPayload?.actionFamily) return parsedPayload.actionFamily;
  const text =
    proposed.source_message ??
    proposed.title ??
    (typeof payload.original_message === "string" ? payload.original_message : null);
  if (text?.trim()) return inferActionFamilyFromText(text);
  return null;
}

function threadFamilyKeysForItem(item: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  const identityKey = threadFamilyKeyFromIdentity(item.action_identity as string | undefined);
  if (identityKey) keys.add(identityKey);

  const metadata = (item.source_metadata ?? {}) as Record<string, unknown>;
  const payload = (item.action_payload ?? {}) as Record<string, unknown>;
  const channelId =
    (typeof metadata.slack_channel_id === "string" ? metadata.slack_channel_id : null) ??
    (typeof payload.slack_channel_id === "string" ? payload.slack_channel_id : null);
  const threadTs =
    (typeof metadata.slack_thread_ts === "string" ? metadata.slack_thread_ts : null) ??
    (typeof payload.slack_thread_ts === "string" ? payload.slack_thread_ts : null);
  const family = actionFamilyFromItem(item);
  if (channelId && threadTs && family) {
    keys.add(threadFamilyKeyFromSlackContext({ channelId, threadTs, actionFamily: family }));
  }
  return [...keys];
}

function threadFamilyKeysForProposed(proposed: ProposedPmAction): string[] {
  const keys = new Set<string>();
  const identityKey = threadFamilyKeyFromIdentity(proposed.action_identity ?? undefined);
  if (identityKey) keys.add(identityKey);

  const payload = (proposed.action_payload ?? {}) as Record<string, unknown>;
  const parsed = parseSlackActionIdentity(payload.action_identity as string | undefined);
  if (parsed) {
    keys.add(threadFamilyKeyFromSlackContext({
      channelId: parsed.channelId,
      threadTs: parsed.threadTs,
      actionFamily: parsed.actionFamily,
    }));
  }

  const channelId = typeof payload.slack_channel_id === "string" ? payload.slack_channel_id : null;
  const threadTs = typeof payload.slack_thread_ts === "string" ? payload.slack_thread_ts : null;
  const family = actionFamilyFromProposed(proposed);
  if (channelId && threadTs && family) {
    keys.add(threadFamilyKeyFromSlackContext({ channelId, threadTs, actionFamily: family }));
  }
  return [...keys];
}

export function matchesThreadAndFamily(item: Record<string, unknown>, proposed: ProposedPmAction): boolean {
  const itemKeys = threadFamilyKeysForItem(item);
  const proposedKeys = threadFamilyKeysForProposed(proposed);
  if (itemKeys.length === 0 || proposedKeys.length === 0) return false;

  for (const itemKey of itemKeys) {
    for (const proposedKey of proposedKeys) {
      if (itemKey === proposedKey) return true;
      const [, , itemFamily] = itemKey.split(":").length >= 3
        ? [null, null, itemKey.split(":").slice(2).join(":")]
        : [null, null, null];
      const proposedParts = proposedKey.split(":");
      const proposedFamily = proposedParts.slice(2).join(":");
      const itemParts = itemKey.split(":");
      const itemFamilyParsed = itemParts.slice(2).join(":");
      if (
        itemParts[0] === proposedParts[0] &&
        itemParts[1] === proposedParts[1] &&
        actionFamiliesEquivalent(itemFamilyParsed, proposedFamily)
      ) {
        return true;
      }
    }
  }

  const itemFamily = actionFamilyFromItem(item);
  const proposedFamily = actionFamilyFromProposed(proposed);
  if (!itemFamily || !proposedFamily || !actionFamiliesEquivalent(itemFamily, proposedFamily)) {
    return false;
  }

  const itemThread = item.source_thread_key as string | undefined;
  const proposedThread =
    proposed.source_thread_key ??
    (typeof (proposed.action_payload ?? {}).slack_thread_key === "string"
      ? (proposed.action_payload as Record<string, unknown>).slack_thread_key as string
      : null);
  return !!(itemThread && proposedThread && itemThread === proposedThread);
}

export function actionMatchesProposed(item: Record<string, unknown>, proposed: ProposedPmAction): boolean {
  if (proposed.action_key && item.action_key === proposed.action_key) return true;

  if (proposed.action_identity && item.action_identity === proposed.action_identity) return true;

  if (matchesThreadAndFamily(item, proposed)) return true;

  const proposedPayload = (proposed.action_payload ?? {}) as Record<string, unknown>;
  const proposedIdentity = proposedPayload.action_identity as string | undefined;
  if (proposedIdentity && item.action_identity === proposedIdentity) return true;

  const itemPayload = (item.action_payload ?? {}) as Record<string, unknown>;

  if (payloadThreadMatch(proposedPayload, itemPayload)) return true;

  if (proposed.source_thread_key && item.source_thread_key === proposed.source_thread_key) {
    if (!proposed.source_type || item.source_type === proposed.source_type) {
      if (!proposed.signal_type && !proposed.action_type) return true;
      if (sameSignalTypeFamily(proposed, item)) return true;
      if (proposed.source_type === "slack" || item.source_type === "slack") return true;
    }
  }

  if (
    proposed.source_type &&
    proposed.source_thread_key &&
    item.source_type === proposed.source_type &&
    item.source_thread_key === proposed.source_thread_key
  ) {
    return true;
  }

  const proposedEventIds = proposed.source_event_ids ?? [];
  const itemEventIds = (item.source_event_ids as string[] | undefined) ?? [];
  if (proposedEventIds.length > 0 && proposedEventIds.some((id) => itemEventIds.includes(id))) {
    return true;
  }

  const proposedSignalIds = proposed.source_signal_ids ?? [];
  const itemSignalIds = (itemPayload.source_signal_ids as string[] | undefined) ?? [];
  if (proposedSignalIds.length > 0 && proposedSignalIds.some((id) => itemSignalIds.includes(id))) {
    return true;
  }

  const proposedTitleKey = normalizedTitleKey(proposed.title);
  const itemTitleKey = normalizedTitleKey(item.title as string | null);
  if (
    proposedTitleKey &&
    itemTitleKey &&
    proposedTitleKey === itemTitleKey &&
    !proposed.action_key &&
    !item.action_key
  ) {
    return true;
  }

  return false;
}

export function findExistingActionForSignal(
  existingItems: Record<string, unknown>[],
  proposed: ProposedPmAction,
): ExistingActionMatch {
  const matches = existingItems.filter((item) => actionMatchesProposed(item, proposed));
  if (matches.length === 0) {
    return { kind: "none", item: null, shouldSuppress: false, shouldUpdate: false, shouldReopen: false };
  }

  const open = matches.find((item) => item.status === "open" || item.status === "in_progress");
  if (open) {
    return { kind: "open", item: open, shouldSuppress: false, shouldUpdate: true, shouldReopen: false };
  }

  const dismissed = matches.find((item) => isActionDismissedOrSkipped(item) && !isSuppressionExpired(item));
  if (dismissed) {
    return {
      kind: "dismissed",
      item: dismissed,
      shouldSuppress: true,
      shouldUpdate: false,
      shouldReopen: false,
      suppressionReason: "suppressed_by_dismissed_action",
    };
  }

  const done = matches.find((item) => item.status === "done");
  if (done) {
    const isAccess =
      done.action_type === "request_access" ||
      done.category === "access_needed" ||
      done.blocker_type === "access";
    if (isAccess && proposed.is_escalation && done.completed_at) {
      const completedAt = new Date(done.completed_at as string).getTime();
      const within14Days = Date.now() - completedAt <= 14 * 24 * 60 * 60 * 1000;
      if (within14Days) {
        return { kind: "done", item: done, shouldSuppress: false, shouldUpdate: true, shouldReopen: true };
      }
    }

    if (proposed.source_thread_key || proposed.action_key || matchesThreadAndFamily(done, proposed)) {
      return {
        kind: "done",
        item: done,
        shouldSuppress: true,
        shouldUpdate: false,
        shouldReopen: false,
        suppressionReason: "suppressed_by_completed_action",
      };
    }
  }

  const dismissedByFamily = matches.find(
    (item) =>
      (item.status === "done" || isActionDismissedOrSkipped(item)) &&
      matchesThreadAndFamily(item, proposed),
  );
  if (dismissedByFamily) {
    const kind = dismissedByFamily.status === "done" ? "done" : "dismissed";
    return {
      kind,
      item: dismissedByFamily,
      shouldSuppress: true,
      shouldUpdate: false,
      shouldReopen: false,
      suppressionReason:
        kind === "done" ? "suppressed_by_completed_action" : "suppressed_by_dismissed_action",
    };
  }

  return { kind: "none", item: null, shouldSuppress: false, shouldUpdate: false, shouldReopen: false };
}

export async function recordActionSuppression(args: {
  supabase: { from: (table: string) => unknown };
  dismissedAction: Record<string, unknown>;
  signalAt?: string;
}): Promise<void> {
  const now = args.signalAt ?? new Date().toISOString();
  const count = ((args.dismissedAction.suppressed_signal_count as number) ?? 0) + 1;
  await (args.supabase as { from: (table: string) => { update: (patch: unknown) => { eq: (col: string, val: unknown) => Promise<unknown> } } })
    .from("project_pm_action_items")
    .update({
      suppressed_signal_count: count,
      latest_suppressed_at: now,
    })
    .eq("id", args.dismissedAction.id);
}

export function proposedFromCandidate(candidate: {
  action_key?: string | null;
  action_type?: string;
  category?: string;
  title?: string;
  source_event_ids?: string[];
  action_payload?: Record<string, unknown>;
  source_thread_key?: string | null;
  source_type?: string | null;
  signal_type?: string | null;
  is_escalation?: boolean;
}): ProposedPmAction {
  const payload = candidate.action_payload ?? {};
  return {
    action_key: candidate.action_key ?? null,
    action_identity:
      candidate.action_identity ??
      (typeof payload.action_identity === "string" ? payload.action_identity : null),
    source_thread_key:
      candidate.source_thread_key ??
      (typeof payload.slack_thread_key === "string" ? payload.slack_thread_key : null),
    source_type:
      candidate.source_type ??
      (typeof payload.source === "string" ? payload.source : null),
    signal_type:
      candidate.signal_type ??
      (typeof payload.signal_type === "string" ? payload.signal_type : null),
    action_type: candidate.action_type ?? null,
    category: candidate.category ?? null,
    title: candidate.title ?? null,
    source_message:
      (typeof payload.original_message === "string" ? payload.original_message : null) ??
      candidate.description ??
      null,
    source_event_ids: candidate.source_event_ids ?? [],
    action_payload: payload,
    is_escalation: candidate.is_escalation,
  };
}

export function suppressionReasonFromMatch(
  match: ExistingActionMatch,
  proposed: ProposedPmAction,
): SuppressionReason | null {
  if (!match.shouldSuppress || !match.item?.id) return null;
  const item = match.item;
  return {
    action_key: (proposed.action_key as string | null) ?? (item.action_key as string | null) ?? null,
    reason: match.suppressionReason ?? "suppressed_by_dismissed_action",
    dismissed_action_id: String(item.id),
    thread_key:
      proposed.source_thread_key ??
      (item.source_thread_key as string | null) ??
      null,
    title: (item.title as string | null) ?? proposed.title ?? null,
    dismissed_at: (item.dismissed_at as string | null) ?? (item.completed_at as string | null) ?? null,
    signal_type: proposed.signal_type ?? null,
  };
}
