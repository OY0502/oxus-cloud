import { z } from "npm:zod@3";

export const TaskPrioritySchema = z.enum(["urgent", "high", "normal", "low"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const ImplementationPlanStepSchema = z.object({
  heading: z.string(),
  steps: z.array(z.string()),
});

export const SourceEvidenceSchema = z.object({
  source_type: z.string(),
  source_id: z.string(),
  label: z.string(),
});

export const ResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  retrieved_at: z.string(),
});

export const TaskSpecificationSchema = z.object({
  title: z.string().min(3).max(200),
  task_type: z.string().min(1),
  objective: z.string().min(1),
  context: z.array(z.string()).default([]),
  current_state: z.array(z.string()).default([]),
  scope: z.array(z.string()).default([]),
  out_of_scope: z.array(z.string()).default([]),
  implementation_plan: z.array(ImplementationPlanStepSchema).default([]),
  technical_notes: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).min(1),
  qa_checks: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  blocking_questions: z.array(z.string()).max(3).default([]),
  risks: z.array(z.string()).default([]),
  suggested_priority: TaskPrioritySchema.default("normal"),
  suggested_estimate_minutes: z.number().int().positive().nullable().optional(),
  suggested_status: z.string().nullable().optional(),
  suggested_assignee_ids: z.array(z.string()).default([]),
  source_evidence: z.array(SourceEvidenceSchema).default([]),
  research_sources: z.array(ResearchSourceSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
  quality_score: z.number().min(0).max(100).optional(),
  quality_warnings: z.array(z.string()).default([]),
});

export type TaskSpecification = z.infer<typeof TaskSpecificationSchema>;

export const TaskIntentSchema = z.object({
  should_create_task: z.boolean(),
  task_count: z.number().int().min(0).max(10).default(1),
  outcome_summary: z.string(),
  work_category: z.enum([
    "client_delivery",
    "internal_oxus",
    "research",
    "design",
    "development",
    "qa",
    "access",
    "coordination",
  ]),
  audience: z.string(),
  clickup_needed: z.boolean(),
  duplicate_of_existing: z.boolean().default(false),
  duplicate_candidate_id: z.string().nullable().optional(),
  duplicate_reason: z.string().nullable().optional(),
  blocking_clarification_needed: z.boolean().default(false),
  clarification_questions: z.array(z.string()).max(3).default([]),
  complexity: z.enum(["simple", "moderate", "complex"]).default("moderate"),
  named_technologies: z.array(z.string()).default([]),
  request_summary: z.string(),
});

export type TaskIntent = z.infer<typeof TaskIntentSchema>;

export const ReviewScoresSchema = z.object({
  grounding: z.number().min(0).max(100),
  specificity: z.number().min(0).max(100),
  technical_accuracy: z.number().min(0).max(100),
  actionability: z.number().min(0).max(100),
  testability: z.number().min(0).max(100),
  concision: z.number().min(0).max(100),
  consistency: z.number().min(0).max(100),
  overall: z.number().min(0).max(100),
  issues: z.array(z.string()).default([]),
  passes: z.boolean(),
});

export type ReviewScores = z.infer<typeof ReviewScoresSchema>;

export function normalizePriority(value: unknown): TaskPriority {
  const s = String(value ?? "normal").toLowerCase();
  if (s === "urgent") return "urgent";
  if (s === "high") return "high";
  if (s === "low") return "low";
  if (s === "medium") return "normal";
  return "normal";
}

export function toOxusPriority(priority: TaskPriority): "low" | "medium" | "high" | "urgent" {
  if (priority === "normal") return "medium";
  return priority;
}

export function parseTaskSpecification(raw: unknown): TaskSpecification {
  const obj = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (obj.suggested_priority) {
    obj.suggested_priority = normalizePriority(obj.suggested_priority);
  }
  if (Array.isArray(obj.blocking_questions)) {
    obj.blocking_questions = obj.blocking_questions.slice(0, 3);
  }
  return TaskSpecificationSchema.parse(obj);
}

export function parseTaskIntent(raw: unknown): TaskIntent {
  return TaskIntentSchema.parse(raw);
}

export function parseReviewScores(raw: unknown): ReviewScores {
  return ReviewScoresSchema.parse(raw);
}
