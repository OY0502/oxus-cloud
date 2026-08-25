/** Deno/server config for task generation models and thresholds. */
export function taskGenerationModel(): string {
  return Deno.env.get("TASK_GENERATION_MODEL")?.trim() ||
    Deno.env.get("OPENROUTER_DEFAULT_MODEL")?.trim() ||
    "openai/gpt-5.1";
}

export function taskReviewModel(): string {
  return Deno.env.get("TASK_REVIEW_MODEL")?.trim() || taskGenerationModel();
}

export function taskMinQualityScore(): number {
  const n = Number(Deno.env.get("TASK_MIN_QUALITY_SCORE") ?? "82");
  return Number.isFinite(n) ? n : 82;
}

export function taskMaxRegenerationCount(): number {
  const n = Number(Deno.env.get("TASK_MAX_REGENERATION_COUNT") ?? "1");
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 1)) : 1;
}

export function taskTechResearchCacheDays(): number {
  const n = Number(Deno.env.get("TASK_TECH_RESEARCH_CACHE_DAYS") ?? "30");
  return Number.isFinite(n) ? n : 30;
}

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
