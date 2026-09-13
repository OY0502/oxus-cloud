export type ConversationMessage = { role: string; content: string };

/** Add the active conversation thread when the current request depends on prior referents or intent. */
export function buildHistoryAwareRetrievalQuery(
  currentMessage: string,
  history: ConversationMessage[] = [],
): string {
  const query = currentMessage.trim();
  if (!query || history.length === 0) return query;
  const needsContext = query.length < 180
    || /\b(it|that|those|they|them|this|these|he|she|there|same|above|former|latter|earlier|previous|last (?:one|two|three|\d+))\b/i.test(query)
    || /\b(check|look|review|search|find|verify|compare)\b[\s\S]{0,100}\b(meeting|recording|transcript|message|update|question|request)s?\b/i.test(query)
    || /\boriginal user request\b/i.test(query);
  if (!needsContext) return query;

  const maxTotalChars = 6_000;
  const contextPrefix = "Active conversation thread (resolve the subject and intent from this):\n";
  const queryBlock = `Current question:\n${query.slice(0, 2_000)}`;
  let remaining = maxTotalChars - contextPrefix.length - queryBlock.length - 2;
  const selected: string[] = [];
  for (const message of history.slice(-12).reverse()) {
    if (remaining <= 80) break;
    const perMessageLimit = message.role === "user" ? 900 : 1_100;
    const rolePrefix = `${message.role}: `;
    const content = message.content.replace(/\s+/g, " ").trim().slice(0, Math.min(perMessageLimit, remaining - rolePrefix.length - 1));
    if (!content) continue;
    const line = `${rolePrefix}${content}`;
    selected.unshift(line);
    remaining -= line.length + 1;
  }
  if (selected.length === 0) return query;
  return `${contextPrefix}${selected.join("\n")}\n\n${queryBlock}`;
}
