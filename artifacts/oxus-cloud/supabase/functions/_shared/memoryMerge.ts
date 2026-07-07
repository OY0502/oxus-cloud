/** Normalize list item keys for deduplication. */
export function normalizeMemoryListKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deduplicate strings; drop near-duplicates when one phrase contains another. */
export function dedupeMemoryStringArray(items: string[]): string[] {
  const normalized = items
    .map((item) => item.trim())
    .filter(Boolean);
  const result: string[] = [];
  const keys: string[] = [];

  for (const item of normalized) {
    const key = normalizeMemoryListKey(item);
    if (!key) continue;

    const duplicateIndex = keys.findIndex(
      (existing) => existing === key || existing.includes(key) || key.includes(existing),
    );
    if (duplicateIndex >= 0) {
      // Prefer the longer, more specific wording.
      if (item.length > result[duplicateIndex]!.length) {
        result[duplicateIndex] = item;
        keys[duplicateIndex] = key;
      }
      continue;
    }

    keys.push(key);
    result.push(item);
  }

  return result;
}

/** Append-only merge for scope, users, flows, etc. */
export function mergeAppendStringArrays(existing: string[], incoming: string[]): string[] {
  return dedupeMemoryStringArray([...existing, ...incoming]);
}

/**
 * Refresh merge for risks / open questions: incoming is the AI-refreshed full list.
 * When refresh is not provided, keep existing values.
 */
export function mergeRefreshedStringArrays(
  existing: string[],
  incoming: string[] | undefined | null,
  suppressedKeys?: Set<string>,
): string[] {
  if (incoming === undefined || incoming === null) {
    return dedupeMemoryStringArray(existing);
  }

  let refreshed = dedupeMemoryStringArray(incoming);
  if (suppressedKeys && suppressedKeys.size > 0) {
    refreshed = refreshed.filter((item) => !suppressedKeys.has(normalizeMemoryListKey(item)));
  }
  return refreshed;
}

export function buildSuppressedQuestionKeys(
  rows: Array<{ question: string; status: string }> | null | undefined,
): Set<string> {
  const keys = new Set<string>();
  for (const row of rows ?? []) {
    if (!row.question?.trim()) continue;
    if (row.status === "skipped" || row.status === "cleared" || row.status === "answered") {
      keys.add(normalizeMemoryListKey(row.question));
    }
  }
  return keys;
}

/** Slack message ts compatible string comparison (lexicographic works for Slack ts). */
export function isSlackTsAfter(ts: string, baselineTs: string | null | undefined): boolean {
  if (!baselineTs?.trim()) return true;
  if (!ts?.trim()) return false;
  return ts > baselineTs;
}

export function slackTsNow(): string {
  const seconds = Date.now() / 1000;
  const whole = Math.floor(seconds);
  const fraction = Math.floor((seconds - whole) * 1_000_000);
  return `${whole}.${String(fraction).padStart(6, "0")}`;
}
