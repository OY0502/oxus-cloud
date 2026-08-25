import { TASK_GENERATION_VERSIONS } from "./versions.ts";

export function buildIntentSystemPrompt(): string {
  return [
    "You are a senior technical PM at OXUS analyzing task intent (Stage A only — not full spec).",
    "OXUS delivers FOR the client product in context.",
    `Prompt version: ${TASK_GENERATION_VERSIONS.intent_prompt}`,
    "Output valid JSON only.",
  ].join(" ");
}

export function buildIntentUserPrompt(args: { request: string; contextBlock: string; existingTasksSummary?: string }): string {
  return `Analyze:\n${args.request}\n\n${args.contextBlock}\n${args.existingTasksSummary ?? ""}\nReturn JSON: should_create_task, task_count, outcome_summary, work_category, audience, clickup_needed, duplicate_of_existing, duplicate_candidate_id, duplicate_reason, blocking_clarification_needed, clarification_questions (max 3), complexity (simple|moderate|complex), named_technologies[], request_summary.`;
}

export function buildGeneratorSystemPrompt(): string {
  return [
    "Senior technical PM writing ClickUp tasks for OXUS client delivery.",
    "Ground in project evidence or label Assumption. No generic SEO/hreflang/translation-key advice unless evidenced.",
    "Distinguish source vs target languages. Testable acceptance criteria.",
    `Prompt version: ${TASK_GENERATION_VERSIONS.generator_prompt}`,
    "JSON only.",
  ].join(" ");
}

export function buildGeneratorUserPrompt(args: {
  request: string;
  intentJson: string;
  contextBlock: string;
  researchBlock?: string;
  reviewerFeedback?: string;
}): string {
  const parts = [`Task request:\n${args.request}`, `Intent:\n${args.intentJson}`, args.contextBlock];
  if (args.researchBlock) parts.push(`Official docs:\n${args.researchBlock}`);
  if (args.reviewerFeedback) parts.push(`Fix reviewer issues:\n${args.reviewerFeedback}`);
  parts.push("Return full task specification JSON schema.");
  return parts.join("\n\n");
}

export function buildReviewerSystemPrompt(): string {
  return `Quality reviewer for OXUS task specs. Score dimensions 0-100. Version ${TASK_GENERATION_VERSIONS.reviewer_prompt}. JSON only.`;
}

export function buildReviewerUserPrompt(args: { specJson: string; contextBlock: string; minScore: number }): string {
  return `Context:\n${args.contextBlock}\n\nSpec:\n${args.specJson}\n\nReturn grounding, specificity, technical_accuracy, actionability, testability, concision, consistency, overall, issues[], passes (overall >= ${args.minScore}).`;
}

export function oxusIdentityRules(project?: { projectName?: string | null; clientName?: string | null }): string {
  const client = project?.clientName?.trim() || project?.projectName?.trim();
  return [
    "OXUS = agency. OXUS Cloud = internal tooling.",
    client ? `Client/product: ${client}.` : "Refer to client from context.",
    "Never attribute client product features to OXUS.",
  ].join("\n");
}
