/** Extract readable comment text from ClickUp webhook or API payloads. */

export type CommentMetadata = {
  clickup_comment_id: string | null;
  clickup_parent_comment_id: string | null;
  clickup_thread_id: string | null;
};

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function extractCommentMetadataFromApiComment(comment: any): CommentMetadata {
  const commentId = asString(comment?.id);
  const parentId = asString(comment?.parent ?? comment?.parent_id ?? comment?.parent_comment_id);
  const threadId = parentId ?? commentId;
  return {
    clickup_comment_id: commentId,
    clickup_parent_comment_id: parentId,
    clickup_thread_id: threadId,
  };
}

export function extractCommentMetadataFromPayload(payload: any): CommentMetadata {
  const historyItem = Array.isArray(payload?.history_items) ? payload.history_items[0] : null;
  const commentObj = historyItem?.comment ?? payload?.comment ?? payload;
  const commentId = asString(commentObj?.id ?? historyItem?.id ?? payload?.comment_id);
  const parentId = asString(commentObj?.parent ?? commentObj?.parent_id ?? historyItem?.parent ?? payload?.parent);
  const threadId = parentId ?? commentId;
  return {
    clickup_comment_id: commentId,
    clickup_parent_comment_id: parentId,
    clickup_thread_id: threadId,
  };
}

export function extractCommentTextFromTimelineEvent(event: {
  comment_text?: string | null;
  event_summary?: string | null;
  raw_payload?: unknown;
}): string | null {
  if (typeof event.comment_text === "string" && event.comment_text.trim()) {
    return event.comment_text.trim();
  }
  const payload = (event.raw_payload ?? {}) as Record<string, unknown>;
  const fromPayload =
    (typeof payload.comment_text === "string" && payload.comment_text.trim()) ||
    (typeof payload.extracted_comment_text === "string" && payload.extracted_comment_text.trim()) ||
    extractCommentTextFromApiComment(payload.comment) ||
    extractCommentTextFromPayload(payload);
  if (fromPayload) return fromPayload;
  if (typeof event.event_summary === "string") {
    const match = event.event_summary.match(/:\s*"(.+)"$/s);
    if (match?.[1]) return match[1].replace(/…$/, "").trim();
  }
  return null;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of ["text_content", "comment_text", "text", "comment", "after", "body", "content"]) {
    if (key in obj) collectStrings(obj[key], out);
  }
}

export function extractCommentTextFromPayload(payload: any): string | null {
  const candidates: string[] = [];

  const historyItems = payload?.history_items;
  if (Array.isArray(historyItems)) {
    for (const item of historyItems) {
      if (item?.comment) collectStrings(item.comment, candidates);
      if (item?.after) collectStrings(item.after, candidates);
      if (item?.text) collectStrings(item.text, candidates);
    }
  }

  if (payload?.comment) collectStrings(payload.comment, candidates);
  if (payload?.comment_text) collectStrings(payload.comment_text, candidates);
  if (payload?.text_content) collectStrings(payload.text_content, candidates);

  const unique = [...new Set(candidates.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  return unique.sort((a, b) => b.length - a.length)[0];
}

export function extractCommentTextFromApiComment(comment: any): string | null {
  if (!comment) return null;
  const direct =
    comment.comment_text ??
    comment.text_content ??
    comment.text ??
    (typeof comment.comment === "string" ? comment.comment : null);
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  if (Array.isArray(comment.comment)) {
    const parts = comment.comment
      .map((block: any) => block?.text ?? block?.content ?? "")
      .filter((s: string) => typeof s === "string" && s.trim());
    if (parts.length > 0) return parts.join("\n").trim();
  }

  return extractCommentTextFromPayload(comment);
}

export function commentTimelineDedupeKey(taskId: string, commentId: string): string {
  return `clickup-comment:${taskId}:${commentId}`;
}

export function buildCommentEventSummary(args: {
  taskName: string;
  commentText: string | null;
  actorName?: string | null;
  eventType?: string;
}): string {
  const actorPart = args.actorName ? ` by ${args.actorName}` : "";
  if (args.commentText) {
    const preview = args.commentText.length > 500 ? `${args.commentText.slice(0, 500)}…` : args.commentText;
    return `Comment on "${args.taskName}"${actorPart}: "${preview}"`;
  }
  if (args.eventType === "taskCommentUpdated") {
    return `Comment updated on "${args.taskName}"${actorPart} (text not included in webhook — sync to fetch).`;
  }
  return `Comment posted on "${args.taskName}"${actorPart} (text not included in webhook — sync to fetch).`;
}
