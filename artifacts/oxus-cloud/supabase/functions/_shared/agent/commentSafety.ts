export function isExplicitClickupCommentRequest(text: string): boolean {
  return /\b(?:add|create|draft|post|write|leave|prepare)\b[\s\S]{0,80}\bcomment\b/i.test(text)
    && (/\bclickup\b/i.test(text) || /clickup\.com\//i.test(text));
}

export type ExplicitClickupAction = "add_clickup_comment" | "create_clickup_task" | "create_clickup_doc";

export function detectExplicitClickupAction(text: string): ExplicitClickupAction | null {
  if (isExplicitClickupCommentRequest(text)) return "add_clickup_comment";
  const hasClickupContext = /\bclickup\b/i.test(text) || /clickup\.com\//i.test(text);
  if (!hasClickupContext) return null;
  if (/\b(?:create|add|make|prepare)\b[\s\S]{0,60}\b(?:task|action item)\b/i.test(text)) {
    return "create_clickup_task";
  }
  if (/\b(?:create|add|make|prepare|write)\b[\s\S]{0,60}\b(?:doc|document)\b/i.test(text)) {
    return "create_clickup_doc";
  }
  return null;
}

const TARGET_STOP_WORDS = new Set([
  "a", "about", "add", "and", "based", "clickup", "comment", "create", "discussion",
  "for", "following", "from", "in", "it", "make", "on", "please", "post", "prepare",
  "something", "summarize", "summarizing", "task", "the", "this", "to", "write",
]);

function targetTokens(value: string): string[] {
  return value.toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !TARGET_STOP_WORDS.has(token));
}

export function selectClickupTaskTarget<T extends { id: string; name: string }>(
  request: string,
  tasks: T[],
): T | null {
  const requestTokens = [...new Set(targetTokens(request))];
  if (requestTokens.length === 0) return null;
  const ranked = tasks.map((task) => {
    const nameTokens = new Set(targetTokens(task.name));
    const overlap = requestTokens.filter((token) => nameTokens.has(token));
    const score = overlap.length / Math.max(1, Math.min(requestTokens.length, nameTokens.size));
    return { task, score, overlap: overlap.length };
  }).filter((entry) => entry.overlap > 0).sort((a, b) => b.score - a.score || b.overlap - a.overlap);
  if (ranked.length === 0 || ranked[0].score < 0.5) return null;
  if (ranked[1] && ranked[1].score === ranked[0].score && ranked[1].overlap === ranked[0].overlap) return null;
  return ranked[0].task;
}

export function explicitlyAllowsMentions(text: string): boolean {
  return /\b(?:tag|mention|ping|notify|call\s*out)\b[\s\S]{0,80}(?:\bclient\b|@[\w.-]+)/i.test(text);
}

/**
 * Defense-in-depth for comments where the user did not explicitly authorize
 * direct callouts. The model receives the same rule, but execution sanitizes
 * again so edited confirmation payloads cannot introduce a tag.
 */
export function removeMentionSyntax(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/gi, "")
    .replace(/<!subteam\^[^>]+>/gi, "")
    .replace(/(^|\s)@([\p{L}\p{N}._-]+)/gu, "$1$2")
    .replace(/^(?:thanks\s*[—–-]\s*)?(?:tagging|mentioning|pinging|notifying)\b.*$/gimu, "")
    .replace(/^[\p{Lu}][\p{L} .'-]{1,40}\s+[—–]\s+(?:please\s+)?/gmu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
