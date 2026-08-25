import { TASK_GENERATION_VERSIONS } from "./versions";

export function buildIntentSystemPrompt(): string {
  return [
    "You are a senior technical PM at OXUS (agency) analyzing whether a ClickUp-ready task is needed.",
    "Stage A only: determine task INTENT — do not write the full implementation specification.",
    "OXUS delivers work FOR the client/product described in context, not for OXUS itself.",
    "Use project memory as authoritative over model assumptions.",
    `Prompt version: ${TASK_GENERATION_VERSIONS.intent_prompt}`,
    "Output valid JSON only.",
  ].join(" ");
}

export function buildIntentUserPrompt(args: {
  request: string;
  contextBlock: string;
  existingTasksSummary?: string;
}): string {
  return `Analyze this task request.

Request:
${args.request}

${args.contextBlock}

${args.existingTasksSummary ? `Existing related tasks:\n${args.existingTasksSummary}` : ""}

Return JSON:
{
  "should_create_task": boolean,
  "task_count": number,
  "outcome_summary": "string",
  "work_category": "client_delivery|internal_oxus|research|design|development|qa|access|coordination",
  "audience": "who benefits from the work",
  "clickup_needed": boolean,
  "duplicate_of_existing": boolean,
  "duplicate_candidate_id": "string|null",
  "duplicate_reason": "string|null",
  "blocking_clarification_needed": boolean,
  "clarification_questions": ["max 3, prefer 0"],
  "complexity": "simple|moderate|complex",
  "named_technologies": ["string"],
  "request_summary": "one sentence"
}

Rules:
- Prefer should_create_task=false when an existing task already covers the work.
- Max 3 clarification_questions; prefer 0.
- Only ask when answer materially changes implementation AND is not in project memory.
- Assess complexity: simple UI/copy fixes vs complex integrations.`;
}

export function buildGeneratorSystemPrompt(): string {
  return [
    "You are a senior technical PM writing ClickUp-ready implementation tasks for OXUS client delivery.",
    "Write for the CLIENT's product (e.g. Carrotz), not for OXUS Cloud internal tooling.",
    "Ground every requirement in project evidence, official documentation facts provided, or label as Assumption.",
    "Do NOT include generic checklist items (public SEO, hreflang, translation keys) unless evidence supports them.",
    "Distinguish source language vs target languages for multilingual work.",
    "Acceptance criteria must be observable and testable — name screens, flows, and data that stay unchanged.",
    "Keep simple tasks concise; complex integrations get structured implementation_plan sections.",
    "Maximum 3 blocking_questions; prefer assumptions for non-blocking unknowns.",
    `Prompt version: ${TASK_GENERATION_VERSIONS.generator_prompt}`,
    "Output valid JSON matching the task specification schema only.",
  ].join(" ");
}

export function buildGeneratorUserPrompt(args: {
  request: string;
  intentJson: string;
  contextBlock: string;
  researchBlock?: string;
  reviewerFeedback?: string;
}): string {
  const parts = [
    `Write a detailed task specification for:\n${args.request}`,
    `Intent analysis:\n${args.intentJson}`,
    args.contextBlock,
  ];
  if (args.researchBlock) parts.push(`Official documentation facts (verified — cite in research_sources):\n${args.researchBlock}`);
  if (args.reviewerFeedback) {
    parts.push(`Quality reviewer feedback — address these issues in your revision:\n${args.reviewerFeedback}`);
  }
  parts.push(`Return JSON with fields:
title, task_type, objective, context[], current_state[], scope[], out_of_scope[],
implementation_plan[{heading, steps[]}], technical_notes[], dependencies[], deliverables[],
acceptance_criteria[], qa_checks[], assumptions[], blocking_questions[] (max 3),
risks[], suggested_priority (urgent|high|normal|low), suggested_estimate_minutes,
suggested_status, suggested_assignee_ids[], source_evidence[], research_sources[],
confidence, quality_warnings[]`);
  return parts.join("\n\n");
}

export function buildReviewerSystemPrompt(): string {
  return [
    "You are a quality reviewer for OXUS Cloud task specifications.",
    "Score 0-100 on: grounding, specificity, technical_accuracy, actionability, testability, concision, consistency.",
    "Flag generic filler, wrong OXUS/client attribution, irrelevant public SEO for private apps, hallucinated provider behavior.",
    "Flag vague acceptance criteria and source/target language confusion.",
    `Prompt version: ${TASK_GENERATION_VERSIONS.reviewer_prompt}`,
    "Output valid JSON only.",
  ].join(" ");
}

export function buildReviewerUserPrompt(args: {
  specJson: string;
  contextBlock: string;
  minScore: number;
}): string {
  return `Review this task specification against project context.

Context:
${args.contextBlock}

Specification:
${args.specJson}

Return JSON:
{
  "grounding": 0-100,
  "specificity": 0-100,
  "technical_accuracy": 0-100,
  "actionability": 0-100,
  "testability": 0-100,
  "concision": 0-100,
  "consistency": 0-100,
  "overall": 0-100,
  "issues": ["specific issues"],
  "passes": boolean (true if overall >= ${args.minScore})
}`;
}

export function oxusIdentityRules(project?: {
  projectName?: string | null;
  clientName?: string | null;
}): string {
  const client = project?.clientName?.trim() || project?.projectName?.trim();
  return [
    "Identity:",
    "- OXUS (all caps) is the delivery agency.",
    "- OXUS Cloud is internal agency tooling — not the client's product.",
    client ? `- Client/product: ${client}. Implementation is for their product.` : "- Refer to the client/product from context.",
    "- Never say OXUS needs client product features.",
  ].join("\n");
}
