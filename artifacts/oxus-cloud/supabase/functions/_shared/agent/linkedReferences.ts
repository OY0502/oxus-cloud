import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveUserClickupForProject } from "../clickup-auth.ts";
import { fetchClickupTask, fetchClickupTaskComments } from "../clickup.ts";
import { getSlackWorkspaceTokenOrThrow } from "../slack-auth.ts";
import { callSlackApi } from "../slack.ts";

export type LinkedReference = {
  kind: "slack_message" | "clickup_task";
  url: string;
  data: Record<string, unknown>;
};

export type LinkedReferenceResolution = {
  references: LinkedReference[];
  warnings: string[];
};

function extractHttpUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"']+/gi)?.map((url) => url.replace(/[),.;!?]+$/, "")) ?? [])];
}

export function slackTimestampFromPermalink(value: string): string | null {
  const digits = value.replace(/^p/i, "");
  if (!/^\d{7,}$/.test(digits)) return null;
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`;
}

export function clickupTaskIdFromUrl(url: URL): string | null {
  if (!/(^|\.)clickup\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const marker = parts.findIndex((part) => part === "t" || part === "task");
  return marker >= 0 && parts[marker + 1] ? decodeURIComponent(parts[marker + 1]) : null;
}

function commentText(comment: Record<string, unknown>): string {
  if (typeof comment.comment_text === "string") return comment.comment_text;
  if (typeof comment.text_content === "string") return comment.text_content;
  if (!Array.isArray(comment.comment)) return "";
  return comment.comment.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const row = part as Record<string, unknown>;
    return String(row.text ?? row.content ?? "");
  }).join("");
}

function normalizeClickupComment(comment: Record<string, unknown>) {
  const user = (comment.user ?? {}) as Record<string, unknown>;
  return {
    id: String(comment.id ?? ""),
    text: commentText(comment).slice(0, 4000),
    author: String(user.username ?? user.email ?? "Unknown"),
    created_at: typeof comment.date === "string" && /^\d+$/.test(comment.date)
      ? new Date(Number(comment.date)).toISOString()
      : comment.date ?? null,
  };
}

async function resolveSlackReference(args: {
  admin: SupabaseClient;
  url: URL;
  link: Record<string, unknown> | null;
}): Promise<LinkedReference> {
  const match = args.url.pathname.match(/^\/archives\/([^/]+)\/p(\d+)/i);
  if (!match) throw new Error("The Slack link is not a message permalink.");
  const linkedChannel = String(args.link?.slack_channel_id ?? "");
  if (!linkedChannel || args.link?.include_in_ai === false) throw new Error("Slack is not available to project chat.");
  if (match[1] !== linkedChannel) throw new Error("That Slack message is outside this project's connected channel.");
  const teamId = String(args.link?.slack_team_id ?? "");
  if (!teamId) throw new Error("The project Slack workspace is not connected.");

  const messageTs = slackTimestampFromPermalink(match[2]);
  if (!messageTs) throw new Error("The Slack message timestamp is invalid.");
  const threadTs = args.url.searchParams.get("thread_ts");
  const { token } = await getSlackWorkspaceTokenOrThrow(args.admin, teamId);
  let messages: Array<Record<string, unknown>> = [];

  if (threadTs) {
    const response = await callSlackApi<{ messages?: Array<Record<string, unknown>> }>(token, "conversations.replies", {
      channel: linkedChannel,
      ts: threadTs,
      limit: 100,
    });
    messages = response.messages ?? [];
  } else {
    const response = await callSlackApi<{ messages?: Array<Record<string, unknown>> }>(token, "conversations.history", {
      channel: linkedChannel,
      oldest: messageTs,
      latest: messageTs,
      inclusive: true,
      limit: 1,
    });
    const parent = response.messages?.[0];
    if (parent) messages = [parent];
    if (parent && Number(parent.reply_count ?? 0) > 0 && typeof parent.ts === "string") {
      const replies = await callSlackApi<{ messages?: Array<Record<string, unknown>> }>(token, "conversations.replies", {
        channel: linkedChannel,
        ts: parent.ts,
        limit: 100,
      });
      messages = replies.messages ?? messages;
    }
  }
  if (messages.length === 0) throw new Error("The linked Slack message could not be read.");

  const userIds = [...new Set(messages.map((message) => String(message.user ?? "")).filter(Boolean))].slice(0, 20);
  const names = new Map<string, string>();
  await Promise.all(userIds.map(async (userId) => {
    try {
      const response = await callSlackApi<{ user?: Record<string, unknown> }>(token, "users.info", { user: userId });
      const profile = (response.user?.profile ?? {}) as Record<string, unknown>;
      names.set(userId, String(profile.display_name ?? profile.real_name ?? response.user?.real_name ?? userId));
    } catch {
      names.set(userId, userId);
    }
  }));

  return {
    kind: "slack_message",
    url: args.url.toString(),
    data: {
      channel_id: linkedChannel,
      requested_message_ts: messageTs,
      thread_ts: threadTs,
      messages: messages.map((message) => ({
        ts: message.ts ?? null,
        thread_ts: message.thread_ts ?? null,
        author: names.get(String(message.user ?? "")) ?? String(message.user ?? "Unknown"),
        text: String(message.text ?? "").slice(0, 5000),
      })).filter((message) => message.text.trim()),
    },
  };
}

async function resolveClickupReference(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  url: URL;
  link: Record<string, unknown> | null;
}): Promise<LinkedReference> {
  const taskId = clickupTaskIdFromUrl(args.url);
  if (!taskId) throw new Error("The ClickUp link does not contain a task ID.");
  const { clickup } = await resolveUserClickupForProject(args.userId, args.projectId);
  const task = await fetchClickupTask(clickup, taskId) as Record<string, unknown>;
  const space = (task.space ?? {}) as Record<string, unknown>;
  const linkedSpaceId = String(args.link?.clickup_space_id ?? "");
  const linkedTask = await args.admin.from("clickup_task_links")
    .select("id")
    .eq("project_id", args.projectId)
    .eq("clickup_task_id", taskId)
    .maybeSingle();
  if (!linkedTask.data && (!linkedSpaceId || String(space.id ?? "") !== linkedSpaceId)) {
    throw new Error("That ClickUp task is outside this project's connected space.");
  }

  const comments = await fetchClickupTaskComments(clickup, taskId);
  const requestedCommentId = args.url.searchParams.get("comment")
    ?? args.url.searchParams.get("comment_id")
    ?? args.url.pathname.match(/\/comments?\/([^/]+)/i)?.[1]
    ?? args.url.hash.match(/comment[-_=]([^&]+)/i)?.[1]
    ?? null;
  const normalizedComments = comments.map((comment) => normalizeClickupComment(comment as Record<string, unknown>));
  const selectedComments = requestedCommentId
    ? normalizedComments.filter((comment) => comment.id === requestedCommentId)
    : normalizedComments.slice(0, 20);
  if (requestedCommentId && selectedComments.length === 0) {
    throw new Error("The linked ClickUp comment could not be found on that task.");
  }
  const status = (task.status ?? {}) as Record<string, unknown>;
  const list = (task.list ?? {}) as Record<string, unknown>;

  return {
    kind: "clickup_task",
    url: args.url.toString(),
    data: {
      task_id: taskId,
      task_name: String(task.name ?? taskId),
      task_url: String(task.url ?? args.url.toString()),
      description: String(task.text_content ?? task.description ?? "").slice(0, 7000),
      status: String(status.status ?? "unknown"),
      list: String(list.name ?? ""),
      comments: selectedComments,
      requested_comment_id: requestedCommentId,
    },
  };
}

export async function resolveExplicitLinkedReferences(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  text: string;
  slackLink?: Record<string, unknown> | null;
  slackLinks?: Record<string, unknown>[];
  clickupLink: Record<string, unknown> | null;
}): Promise<LinkedReferenceResolution> {
  const references: LinkedReference[] = [];
  const warnings: string[] = [];
  for (const rawUrl of extractHttpUrls(args.text).slice(0, 6)) {
    try {
      const url = new URL(rawUrl);
      if (/(^|\.)slack\.com$/i.test(url.hostname)) {
        const linkedChannel = url.pathname.match(/^\/archives\/([^/]+)/i)?.[1] ?? "";
        const slackLink = args.slackLinks?.find((link) =>
          String(link.slack_channel_id ?? "") === linkedChannel && link.include_in_ai !== false
        ) ?? args.slackLink ?? null;
        references.push(await resolveSlackReference({ admin: args.admin, url, link: slackLink }));
      } else if (/(^|\.)clickup\.com$/i.test(url.hostname)) {
        references.push(await resolveClickupReference({
          admin: args.admin,
          projectId: args.projectId,
          userId: args.userId,
          url,
          link: args.clickupLink,
        }));
      }
    } catch (error) {
      warnings.push(`${rawUrl}: ${(error as Error).message}`);
    }
  }
  return { references, warnings };
}

export {
  explicitlyAllowsMentions,
  isExplicitClickupCommentRequest,
  removeMentionSyntax,
} from "./commentSafety.ts";
