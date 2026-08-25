export type ExistingTaskRef = { id: string; title: string; status?: string | null; source?: string | null };

export type DuplicateDetectionResult = {
  is_duplicate: boolean;
  duplicate_candidate_id: string | null;
  match_reason: string | null;
  confidence: number;
  recommended_action: "create_new" | "extend_existing" | "skip";
};

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(title: string): Set<string> {
  const stop = new Set(["the", "a", "an", "to", "for", "in", "on", "and", "or", "with", "into", "from"]);
  return new Set(normalizeTitle(title).split(" ").filter((w) => w.length > 2 && !stop.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function detectDuplicateTask(args: {
  request: string;
  proposedTitle: string;
  existingTasks: ExistingTaskRef[];
}): DuplicateDetectionResult {
  const requestTokens = tokenSet(`${args.request} ${args.proposedTitle}`);
  let best: { task: ExistingTaskRef; score: number; reason: string } | null = null;
  for (const task of args.existingTasks) {
    if (normalizeTitle(task.title) === normalizeTitle(args.proposedTitle)) {
      return { is_duplicate: true, duplicate_candidate_id: task.id, match_reason: "Exact title match", confidence: 0.98, recommended_action: "skip" };
    }
    const titleScore = jaccard(tokenSet(task.title), tokenSet(args.proposedTitle));
    const requestScore = jaccard(tokenSet(task.title), requestTokens);
    const score = Math.max(titleScore, requestScore * 0.9);
    if (score >= 0.72 && (!best || score > best.score)) {
      best = { task, score, reason: titleScore >= requestScore ? "High title similarity" : "Request matches existing objective" };
    }
  }
  if (best && best.score >= 0.72) {
    return {
      is_duplicate: true,
      duplicate_candidate_id: best.task.id,
      match_reason: best.reason,
      confidence: Math.min(0.95, best.score),
      recommended_action: best.score >= 0.85 ? "skip" : "extend_existing",
    };
  }
  return { is_duplicate: false, duplicate_candidate_id: null, match_reason: null, confidence: 0, recommended_action: "create_new" };
}

export function assessTaskComplexity(request: string, namedTechnologies: string[] = []): "simple" | "moderate" | "complex" {
  const lower = request.toLowerCase();
  if (namedTechnologies.length === 0 && (/\b(change|update|fix|rename|replace)\b.*\b(text|label|copy|button|title)\b/.test(lower) || lower.length < 80)) {
    return "simple";
  }
  if (namedTechnologies.length >= 1 || /\bintegrat(e|ion)\b|\bmultilingual\b|\bi18n\b|\blocali[sz]e\b/.test(lower) || lower.length > 200) {
    return "complex";
  }
  return "moderate";
}

export function extractNamedTechnologies(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  const patterns: [string, RegExp][] = [
    ["Weglot", /\bweglot\b/], ["Bubble", /\bbubble\b/], ["Stripe", /\bstripe\b/],
    ["TipTap", /\btiptap\b/], ["Mixpanel", /\bmixpanel\b/], ["Supabase", /\bsupabase\b/],
  ];
  for (const [name, re] of patterns) if (re.test(lower)) found.push(name);
  return found;
}
