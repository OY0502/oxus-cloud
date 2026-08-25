import type { TaskSpecification } from "./schema";

function bulletSection(title: string, items: string[]): string[] {
  if (!items.length) return [];
  return [title, ...items.map((item) => `- ${item}`), ""];
}

function implementationSection(plan: TaskSpecification["implementation_plan"]): string[] {
  if (!plan.length) return [];
  const lines: string[] = ["## Scope / Implementation"];
  for (const section of plan) {
    if (section.heading?.trim()) lines.push(`### ${section.heading.trim()}`);
    for (const step of section.steps ?? []) {
      if (step.trim()) lines.push(`- ${step.trim()}`);
    }
    lines.push("");
  }
  return lines;
}

/** Render structured task spec into ClickUp-ready Markdown. Omits empty sections. */
export function renderTaskSpecificationMarkdown(spec: TaskSpecification): string {
  const lines: string[] = [];

  if (spec.objective?.trim()) {
    lines.push("## Objective", spec.objective.trim(), "");
  }

  const contextItems = [
    ...(spec.context ?? []),
    ...(spec.current_state ?? []).map((s) => `Current state: ${s}`),
  ].filter(Boolean);
  lines.push(...bulletSection("## Context", contextItems));

  if (spec.scope.length || spec.implementation_plan.length) {
    if (spec.scope.length && !spec.implementation_plan.length) {
      lines.push(...bulletSection("## Scope / Implementation", spec.scope));
    } else if (spec.scope.length && spec.implementation_plan.length) {
      lines.push("## Scope / Implementation");
      lines.push(...spec.scope.map((s) => `- ${s}`), "");
      lines.push(...implementationSection(spec.implementation_plan).slice(1));
    } else {
      lines.push(...implementationSection(spec.implementation_plan));
    }
  }

  lines.push(...bulletSection("## Technical notes", spec.technical_notes ?? []));
  lines.push(...bulletSection("## Dependencies", spec.dependencies ?? []));
  lines.push(...bulletSection("## Deliverables", spec.deliverables ?? []));
  lines.push(...bulletSection("## Acceptance criteria", spec.acceptance_criteria ?? []));
  lines.push(...bulletSection("## QA checks", spec.qa_checks ?? []));

  if (spec.assumptions?.length) {
    lines.push(...bulletSection("## Assumptions", spec.assumptions));
  }
  if (spec.blocking_questions?.length) {
    lines.push(...bulletSection("## Blocking questions", spec.blocking_questions));
  }
  if (spec.out_of_scope?.length) {
    lines.push(...bulletSection("## Out of scope", spec.out_of_scope));
  }
  if (spec.risks?.length) {
    lines.push(...bulletSection("## Risks", spec.risks));
  }

  return lines.join("\n").trim();
}

/** Legacy ai_proposed_tasks row → ClickUp markdown (backward compatible). */
export function renderLegacyProposedTaskMarkdown(task: {
  description?: string | null;
  acceptance_criteria?: string[];
  qa_scenarios?: Array<{ title?: string; priority?: string; steps?: string[]; expected_result?: string }>;
  implementation_notes?: string[];
  design_notes?: string[];
}): string {
  const lines: string[] = [];
  if (task.description?.trim()) {
    lines.push("## Objective", task.description.trim(), "");
  }
  if (Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0) {
    lines.push(...bulletSection("## Acceptance criteria", task.acceptance_criteria));
  }
  if (Array.isArray(task.qa_scenarios) && task.qa_scenarios.length > 0) {
    lines.push("## QA checks");
    for (const scenario of task.qa_scenarios) {
      lines.push(`### ${scenario.title ?? "Scenario"}${scenario.priority ? ` (${scenario.priority})` : ""}`);
      if (Array.isArray(scenario.steps)) {
        for (const step of scenario.steps) lines.push(`- ${step}`);
      }
      if (scenario.expected_result) lines.push(`**Expected:** ${scenario.expected_result}`);
      lines.push("");
    }
  }
  if (Array.isArray(task.implementation_notes) && task.implementation_notes.length > 0) {
    lines.push(...bulletSection("## Technical notes", task.implementation_notes));
  }
  if (Array.isArray(task.design_notes) && task.design_notes.length > 0) {
    lines.push(...bulletSection("## Design notes", task.design_notes));
  }
  return lines.join("\n").trim();
}

export function resolveClickupMarkdown(args: {
  markdown_description?: string | null;
  structured_spec?: TaskSpecification | null;
  legacy?: Parameters<typeof renderLegacyProposedTaskMarkdown>[0];
}): string {
  if (args.markdown_description?.trim()) return args.markdown_description.trim();
  if (args.structured_spec) return renderTaskSpecificationMarkdown(args.structured_spec);
  if (args.legacy) return renderLegacyProposedTaskMarkdown(args.legacy);
  return "";
}
