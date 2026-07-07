import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AgentToolName } from "./types.ts";

export type WorkflowStepMeta = {
  workflow_id: string;
  workflow_name: string;
  step_key: string;
  step_order: number;
  depends_on: string[];
};

export type WorkflowStepResult = {
  external_id?: string;
  url?: string;
  title?: string;
  doc_id?: string;
  clickup_task_id?: string;
  [key: string]: unknown;
};

const EXTERNAL_ID_KEYS: Record<string, string[]> = {
  create_clickup_doc: ["doc_id", "external_id"],
  create_clickup_task: ["clickup_task_id", "external_id"],
  link_clickup_doc_to_task: ["link_mode"],
};

export function workflowMetaFromPayload(payload: Record<string, unknown>): WorkflowStepMeta | null {
  const wf = payload.workflow as Record<string, unknown> | undefined;
  if (!wf?.workflow_id || !wf?.step_key) return null;
  return {
    workflow_id: String(wf.workflow_id),
    workflow_name: String(wf.workflow_name ?? "Agent workflow"),
    step_key: String(wf.step_key),
    step_order: typeof wf.step_order === "number" ? wf.step_order : 0,
    depends_on: Array.isArray(wf.depends_on) ? wf.depends_on.filter((d): d is string => typeof d === "string") : [],
  };
}

export function attachWorkflowToPayload(
  payload: Record<string, unknown>,
  meta: WorkflowStepMeta,
): Record<string, unknown> {
  return {
    ...payload,
    workflow: {
      workflow_id: meta.workflow_id,
      workflow_name: meta.workflow_name,
      step_key: meta.step_key,
      step_order: meta.step_order,
      depends_on: meta.depends_on,
    },
  };
}

export function externalIdFromResult(toolName: string, result: Record<string, unknown>): string | undefined {
  const keys = EXTERNAL_ID_KEYS[toolName] ?? ["external_id", "id"];
  for (const key of keys) {
    const val = result[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return undefined;
}

export function urlFromResult(result: Record<string, unknown>): string | undefined {
  const url = result.url;
  return typeof url === "string" && url.trim() ? url.trim() : undefined;
}

/** Resolve {{step_key.field}} template refs against prior step results. */
export function resolveWorkflowRefs(
  value: unknown,
  stepResults: Map<string, WorkflowStepResult>,
): unknown {
  if (typeof value !== "string") return value;
  const template = value.match(/^\{\{([^.}]+)\.([^}]+)\}\}$/);
  if (!template) return value;
  const [, stepKey, field] = template;
  const result = stepResults.get(stepKey);
  if (!result) return value;
  if (field === "external_id") {
    return result.external_id ?? result.doc_id ?? result.clickup_task_id ?? value;
  }
  if (field === "url") return result.url ?? value;
  const direct = result[field];
  return typeof direct === "string" ? direct : value;
}

export function resolveWorkflowPayload(
  payload: Record<string, unknown>,
  stepResults: Map<string, WorkflowStepResult>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (key === "workflow") {
      out[key] = val;
      continue;
    }
    if (typeof val === "string") {
      out[key] = resolveWorkflowRefs(val, stepResults);
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = resolveWorkflowPayload(val as Record<string, unknown>, stepResults);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function topologicalSortSteps<T extends { step_key: string; depends_on: string[] }>(steps: T[]): T[] {
  const byKey = new Map(steps.map((s) => [s.step_key, s]));
  const sorted: T[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(step: T) {
    if (visited.has(step.step_key)) return;
    if (visiting.has(step.step_key)) {
      throw new Error(`Workflow cycle detected at step ${step.step_key}`);
    }
    visiting.add(step.step_key);
    for (const dep of step.depends_on) {
      const depStep = byKey.get(dep);
      if (depStep) visit(depStep);
    }
    visiting.delete(step.step_key);
    visited.add(step.step_key);
    sorted.push(step);
  }

  for (const step of steps) visit(step);
  return sorted;
}

export type WorkflowToolRunRow = {
  id: string;
  tool_name: string;
  status: string;
  step_key: string | null;
  step_order: number | null;
  depends_on: string[] | null;
  input_payload: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
};

export async function loadWorkflowToolRuns(args: {
  admin: SupabaseClient;
  workflowId: string;
  projectId: string;
}): Promise<WorkflowToolRunRow[]> {
  const { data, error } = await args.admin
    .from("agent_tool_runs")
    .select("id, tool_name, status, step_key, step_order, depends_on, input_payload, result_payload")
    .eq("workflow_id", args.workflowId)
    .eq("project_id", args.projectId)
    .order("step_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    input_payload: (row.input_payload ?? {}) as Record<string, unknown>,
    result_payload: (row.result_payload ?? null) as Record<string, unknown> | null,
  }));
}

export function stepResultFromPayload(
  toolName: string,
  result: Record<string, unknown>,
): WorkflowStepResult {
  return {
    ...result,
    external_id: externalIdFromResult(toolName, result),
    url: urlFromResult(result),
    doc_id: typeof result.doc_id === "string" ? result.doc_id : undefined,
    clickup_task_id: typeof result.clickup_task_id === "string" ? result.clickup_task_id : undefined,
  };
}

export function isWorkflowConfirmable(runs: WorkflowToolRunRow[]): boolean {
  return runs.length > 0 && runs.every((r) => r.status === "needs_confirmation" || r.status === "pending");
}

export const WORKFLOW_SIDE_EFFECT_TOOLS = new Set<AgentToolName>([
  "create_clickup_doc",
  "create_clickup_task",
  "link_clickup_doc_to_task",
]);
