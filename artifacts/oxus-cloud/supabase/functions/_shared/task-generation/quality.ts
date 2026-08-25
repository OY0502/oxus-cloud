import type { ProjectTechnicalProfile } from "./technicalProfile.ts";
import type { TaskIntent, TaskSpecification } from "./schema.ts";

export type QualityDimensionScores = {
  grounding: number;
  specificity: number;
  technical_accuracy: number;
  actionability: number;
  testability: number;
  concision: number;
  consistency: number;
};

export function scoreReviewDimensions(input: {
  spec: TaskSpecification;
  intent: TaskIntent;
  profile?: ProjectTechnicalProfile | null;
  clientName?: string | null;
  projectName?: string | null;
}): QualityDimensionScores {
  const { spec } = input;
  const text = JSON.stringify(spec).toLowerCase();

  let grounding = 70;
  if (spec.source_evidence.length > 0) grounding += 10;
  if (spec.assumptions.length > 0 && spec.blocking_questions.length === 0) grounding += 5;
  if (/\bconfirm\b|\bto be confirmed\b|\bverify\b/i.test(text)) grounding += 5;

  let specificity = 60;
  if (spec.implementation_plan.length > 0) specificity += 15;
  if (spec.technical_notes.length > 0) specificity += 10;
  if (spec.scope.length >= 2) specificity += 10;
  if (/\bif relevant\b|\bas needed\b|\bvarious\b|\bgeneric\b/i.test(text)) specificity -= 15;

  let technical_accuracy = 75;
  const client = (input.clientName ?? input.projectName ?? "").toLowerCase();
  if (client && text.includes("oxus needs") && !text.includes(`${client}`)) technical_accuracy -= 20;
  if (input.profile?.public_or_authenticated === "authenticated" && /\bhreflang\b|\bpublic seo\b|\bindexable\b/i.test(text)) {
    technical_accuracy -= 15;
  }
  if (/\btranslation keys?\b/i.test(text) && /\bweglot\b/i.test(text)) technical_accuracy -= 10;

  let actionability = 65;
  if (spec.dependencies.length > 0) actionability += 10;
  if (spec.deliverables.length > 0) actionability += 10;
  if (spec.implementation_plan.some((p) => p.steps.length >= 2)) actionability += 10;

  let testability = 55;
  const vagueAc = spec.acceptance_criteria.filter((ac) =>
    /\bworks correctly\b|\bproperly\b|\bsuccessfully\b|\bas expected\b/i.test(ac) && ac.length < 60,
  );
  if (vagueAc.length === 0 && spec.acceptance_criteria.length >= 2) testability += 25;
  else if (vagueAc.length > 0) testability -= vagueAc.length * 10;
  if (spec.qa_checks.length >= 2) testability += 10;

  let concision = 80;
  const totalItems =
    spec.context.length + spec.scope.length + spec.technical_notes.length + spec.acceptance_criteria.length +
    spec.implementation_plan.reduce((n, p) => n + p.steps.length, 0);
  if (input.intent.complexity === "simple" && totalItems > 25) concision -= 25;
  if (input.intent.complexity === "complex" && totalItems < 12) concision -= 10;

  let consistency = 85;
  if (spec.blocking_questions.length > 3) consistency -= 15;

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    grounding: clamp(grounding),
    specificity: clamp(specificity),
    technical_accuracy: clamp(technical_accuracy),
    actionability: clamp(actionability),
    testability: clamp(testability),
    concision: clamp(concision),
    consistency: clamp(consistency),
  };
}

export function overallQualityScore(scores: QualityDimensionScores): number {
  return Math.round(
    scores.grounding * 0.2 + scores.specificity * 0.18 + scores.technical_accuracy * 0.18 +
    scores.actionability * 0.14 + scores.testability * 0.14 + scores.concision * 0.08 + scores.consistency * 0.08,
  );
}

export function deterministicQualityWarnings(spec: TaskSpecification): string[] {
  const warnings: string[] = [...(spec.quality_warnings ?? [])];
  if (spec.blocking_questions.length > 3) {
    warnings.push(`Blocking questions exceed maximum (${spec.blocking_questions.length})`);
  }
  return [...new Set(warnings)];
}
