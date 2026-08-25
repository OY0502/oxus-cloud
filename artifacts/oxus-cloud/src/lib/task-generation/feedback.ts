export type TaskEditDiff = {
  title_changed: boolean;
  description_changed: boolean;
  priority_changed: boolean;
  estimate_changed: boolean;
  assignees_changed: boolean;
  acceptance_criteria_changed: boolean;
  retained_text_ratio: number;
};

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordRetentionRatio(original: string, edited: string): number {
  const origWords = normalizeText(original).split(" ").filter(Boolean);
  if (origWords.length === 0) return 1;
  const editedSet = new Set(normalizeText(edited).split(" ").filter(Boolean));
  let kept = 0;
  for (const w of origWords) if (editedSet.has(w)) kept++;
  return Math.round((kept / origWords.length) * 100) / 100;
}

export function computeTaskEditDiff(args: {
  generated: {
    title: string;
    description?: string | null;
    priority?: string | null;
    time_estimate_minutes?: number | null;
    assignee_ids?: string[];
    acceptance_criteria?: string[];
  };
  edited: {
    title: string;
    description?: string | null;
    priority?: string | null;
    time_estimate_minutes?: number | null;
    assignee_ids?: string[];
    acceptance_criteria?: string[];
  };
}): TaskEditDiff {
  const g = args.generated;
  const e = args.edited;
  const titleChanged = normalizeText(g.title) !== normalizeText(e.title);
  const descChanged = normalizeText(g.description ?? "") !== normalizeText(e.description ?? "");
  const priorityChanged = (g.priority ?? "") !== (e.priority ?? "");
  const estimateChanged = (g.time_estimate_minutes ?? null) !== (e.time_estimate_minutes ?? null);
  const assigneesChanged =
    JSON.stringify([...(g.assignee_ids ?? [])].sort()) !== JSON.stringify([...(e.assignee_ids ?? [])].sort());
  const acChanged =
    JSON.stringify(g.acceptance_criteria ?? []) !== JSON.stringify(e.acceptance_criteria ?? []);

  const retained = wordRetentionRatio(
    [g.title, g.description ?? ""].join(" "),
    [e.title, e.description ?? ""].join(" "),
  );

  return {
    title_changed: titleChanged,
    description_changed: descChanged,
    priority_changed: priorityChanged,
    estimate_changed: estimateChanged,
    assignees_changed: assigneesChanged,
    acceptance_criteria_changed: acChanged,
    retained_text_ratio: retained,
  };
}

export type TaskGenerationOutcome =
  | "generated"
  | "needs_review"
  | "duplicate_skipped"
  | "no_task_needed"
  | "failed";

export function outcomeFromEditDiff(diff: TaskEditDiff): "accepted_without_edit" | "accepted_after_edit" {
  const anyChange =
    diff.title_changed ||
    diff.description_changed ||
    diff.priority_changed ||
    diff.estimate_changed ||
    diff.assignees_changed ||
    diff.acceptance_criteria_changed;
  if (!anyChange || diff.retained_text_ratio >= 0.98) return "accepted_without_edit";
  return "accepted_after_edit";
}
