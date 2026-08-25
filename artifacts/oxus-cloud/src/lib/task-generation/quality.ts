import type { ProjectTechnicalProfile } from "./technicalProfile";
import type { TaskIntent, TaskSpecification } from "./schema";

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
  const warnings: string[] = [];

  let grounding = 70;
  if (spec.source_evidence.length > 0) grounding += 10;
  if (spec.assumptions.length > 0 && spec.blocking_questions.length === 0) grounding += 5;
  if (/\bconfirm\b|\bto be confirmed\b|\bverify\b/i.test(text)) grounding += 5;

  let specificity = 60;
  if (spec.implementation_plan.length > 0) specificity += 15;
  if (spec.technical_notes.length > 0) specificity += 10;
  if (spec.scope.length >= 2) specificity += 10;
  if (/\bif relevant\b|\bas needed\b|\bvarious\b|\bgeneric\b/i.test(text)) {
    specificity -= 15;
    warnings.push("Contains vague phrasing");
  }

  let technical_accuracy = 75;
  const client = (input.clientName ?? input.projectName ?? "").toLowerCase();
  if (client && text.includes("oxus needs") && !text.includes(`${client}`)) {
    technical_accuracy -= 20;
    warnings.push("Possible OXUS/client attribution confusion");
  }
  if (input.profile?.public_or_authenticated === "authenticated" && /\bhreflang\b|\bpublic seo\b|\bindexable\b/i.test(text)) {
    technical_accuracy -= 15;
    warnings.push("Public SEO guidance for authenticated app");
  }
  if (/\btranslation keys?\b/i.test(text) && /\bweglot\b/i.test(text)) {
    technical_accuracy -= 10;
    warnings.push("Assumes conventional translation-key model for Weglot");
  }

  let actionability = 65;
  if (spec.dependencies.length > 0) actionability += 10;
  if (spec.deliverables.length > 0) actionability += 10;
  if (spec.implementation_plan.some((p) => p.steps.length >= 2)) actionability += 10;

  let testability = 55;
  const vagueAc = spec.acceptance_criteria.filter((ac) =>
    /\bworks correctly\b|\bproperly\b|\bsuccessfully\b|\bas expected\b/i.test(ac) && ac.length < 60,
  );
  if (vagueAc.length === 0 && spec.acceptance_criteria.length >= 2) testability += 25;
  else if (vagueAc.length > 0) {
    testability -= vagueAc.length * 10;
    warnings.push("Vague acceptance criteria");
  }
  if (spec.qa_checks.length >= 2) testability += 10;

  let concision = 80;
  const totalItems =
    spec.context.length +
    spec.scope.length +
    spec.technical_notes.length +
    spec.acceptance_criteria.length +
    spec.implementation_plan.reduce((n, p) => n + p.steps.length, 0);
  if (input.intent.complexity === "simple" && totalItems > 25) {
    concision -= 25;
    warnings.push("Over-detailed for simple task");
  }
  if (input.intent.complexity === "complex" && totalItems < 12) concision -= 10;

  let consistency = 85;
  if (spec.out_of_scope.some((o) => spec.acceptance_criteria.some((ac) => ac.toLowerCase().includes(o.toLowerCase().slice(0, 20))))) {
    consistency -= 20;
    warnings.push("Acceptance criteria overlap out-of-scope items");
  }
  if (spec.blocking_questions.length > 3) {
    consistency -= 15;
    warnings.push("Too many blocking questions");
  }

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
  const weights = {
    grounding: 0.2,
    specificity: 0.18,
    technical_accuracy: 0.18,
    actionability: 0.14,
    testability: 0.14,
    concision: 0.08,
    consistency: 0.08,
  };
  const overall =
    scores.grounding * weights.grounding +
    scores.specificity * weights.specificity +
    scores.technical_accuracy * weights.technical_accuracy +
    scores.actionability * weights.actionability +
    scores.testability * weights.testability +
    scores.concision * weights.concision +
    scores.consistency * weights.consistency;
  return Math.round(overall);
}

export function deterministicQualityWarnings(spec: TaskSpecification): string[] {
  const warnings: string[] = [...(spec.quality_warnings ?? [])];
  if (spec.blocking_questions.length > 3) {
    warnings.push(`Blocking questions exceed maximum (${spec.blocking_questions.length})`);
  }
  for (const ac of spec.acceptance_criteria) {
    if (/^multilingual support works correctly\.?$/i.test(ac.trim())) {
      warnings.push("Generic acceptance criterion detected");
    }
  }
  return [...new Set(warnings)];
}

export function evaluateWeglotRegressionQualities(spec: TaskSpecification): {
  passed: boolean;
  checks: Record<string, boolean>;
} {
  const text = JSON.stringify(spec).toLowerCase();
  const checks: Record<string, boolean> = {
    private_authenticated: /\bauthenticated\b|\bprivate\b|\blogged-?in\b|\blogin\b/.test(text),
    no_public_seo_priority: !(/\bhreflang\b/.test(text) && !/\bout of scope\b.*seo/i.test(text)),
    dynamic_content: /\bdynamic\b|\bspa\b|\bwithout.*reload\b|\bpage transition\b|\breusable element\b/.test(text),
    translation_exclusions: /\bexclusion\b|\bwork-?order number\b|\bobject id\b|\btechnical code\b|\bstructured value\b/.test(text),
    language_persistence: /\bpersist\b.*\blanguage\b|\blanguage preference\b|\bremember\b.*\blanguage\b/.test(text),
    source_target_distinction: /\bsource language\b|\btarget language\b/.test(text),
    provider_dependencies: /\bweglot\b.*(\bplan\b|\bbilling\b|\bsubscription\b|\baccount\b)/.test(text) ||
      /\b(plan|billing|subscription|account)\b.*\bweglot\b/.test(text),
    testable_acceptance: spec.acceptance_criteria.length >= 2 &&
      !spec.acceptance_criteria.every((ac) => ac.length < 40),
    no_translation_key_assumption: !(/\btranslation keys?\b/i.test(text) && !/\bconfirm\b/i.test(text)),
    oxus_client_distinction: !(/\boxus needs\b/i.test(text) && /\bcarrotz\b/i.test(text)),
    migration_realism: /\bmigrat\b|\bexport\b|\bportability\b/.test(text) ? /\bconfirm\b|\bverify\b|\bdo not assume\b/.test(text) : true,
  };
  const passed = Object.values(checks).filter(Boolean).length >= 8;
  return { passed, checks };
}
