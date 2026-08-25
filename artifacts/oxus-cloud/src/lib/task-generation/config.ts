export function taskGenerationModel(): string {
  return (
    (typeof process !== "undefined" ? process.env.TASK_GENERATION_MODEL : undefined)?.trim() ||
    (typeof process !== "undefined" ? process.env.OPENROUTER_DEFAULT_MODEL : undefined)?.trim() ||
    "openai/gpt-5.1"
  );
}

export function taskReviewModel(): string {
  return (
    (typeof process !== "undefined" ? process.env.TASK_REVIEW_MODEL : undefined)?.trim() ||
    taskGenerationModel()
  );
}

export function taskMinQualityScore(): number {
  const raw = typeof process !== "undefined" ? process.env.TASK_MIN_QUALITY_SCORE : undefined;
  const n = raw ? Number(raw) : 82;
  return Number.isFinite(n) ? n : 82;
}

export function taskMaxRegenerationCount(): number {
  const raw = typeof process !== "undefined" ? process.env.TASK_MAX_REGENERATION_COUNT : undefined;
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 1)) : 1;
}

export function taskTechResearchCacheDays(): number {
  const raw = typeof process !== "undefined" ? process.env.TASK_TECH_RESEARCH_CACHE_DAYS : undefined;
  const n = raw ? Number(raw) : 30;
  return Number.isFinite(n) ? n : 30;
}

export const NAMED_TECHNOLOGIES = [
  "weglot",
  "bubble",
  "stripe",
  "clickup",
  "slack",
  "supabase",
  "firecrawl",
  "pandadoc",
  "google workspace",
  "mixpanel",
  "localise",
  "localize",
  "tiptap",
] as const;

export const OFFICIAL_DOC_DOMAINS: Record<string, string[]> = {
  weglot: ["weglot.com", "support.weglot.com"],
  bubble: ["bubble.io", "manual.bubble.io"],
  stripe: ["stripe.com", "docs.stripe.com"],
  clickup: ["help.clickup.com", "clickup.com"],
  slack: ["api.slack.com", "slack.com"],
  supabase: ["supabase.com"],
  firecrawl: ["docs.firecrawl.dev"],
  pandadoc: ["developers.pandadoc.com", "support.pandadoc.com"],
  mixpanel: ["docs.mixpanel.com"],
  localise: ["localise.biz", "lokalise.com"],
  localize: ["localise.biz", "lokalise.com"],
  tiptap: ["tiptap.dev"],
};
