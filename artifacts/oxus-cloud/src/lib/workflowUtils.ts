import type { AgentToolRun } from "@/lib/types";

export type WorkflowGroup = {
  workflow_id: string;
  workflow_name: string;
  runs: AgentToolRun[];
};

export function workflowIdFromRun(run: AgentToolRun): string | null {
  const fromColumn = (run as AgentToolRun & { workflow_id?: string | null }).workflow_id;
  if (fromColumn) return fromColumn;
  const wf = (run.input_payload as Record<string, unknown> | null)?.workflow as Record<string, unknown> | undefined;
  return typeof wf?.workflow_id === "string" ? wf.workflow_id : null;
}

export function workflowNameFromRun(run: AgentToolRun): string {
  const fromColumn = (run as AgentToolRun & { workflow_name?: string | null }).workflow_name;
  if (fromColumn) return fromColumn;
  const wf = (run.input_payload as Record<string, unknown> | null)?.workflow as Record<string, unknown> | undefined;
  return typeof wf?.workflow_name === "string" ? wf.workflow_name : "Agent workflow";
}

export function stepKeyFromRun(run: AgentToolRun): string | null {
  const fromColumn = (run as AgentToolRun & { step_key?: string | null }).step_key;
  if (fromColumn) return fromColumn;
  const wf = (run.input_payload as Record<string, unknown> | null)?.workflow as Record<string, unknown> | undefined;
  return typeof wf?.step_key === "string" ? wf.step_key : null;
}

export function groupToolRunsByWorkflow(runs: AgentToolRun[]): {
  workflows: WorkflowGroup[];
  standalone: AgentToolRun[];
} {
  const byWorkflow = new Map<string, WorkflowGroup>();
  const standalone: AgentToolRun[] = [];

  for (const run of runs) {
    const wfId = workflowIdFromRun(run);
    if (!wfId) {
      standalone.push(run);
      continue;
    }
    const existing = byWorkflow.get(wfId);
    if (existing) {
      existing.runs.push(run);
    } else {
      byWorkflow.set(wfId, {
        workflow_id: wfId,
        workflow_name: workflowNameFromRun(run),
        runs: [run],
      });
    }
  }

  const workflows = [...byWorkflow.values()].map((g) => ({
    ...g,
    runs: [...g.runs].sort((a, b) => {
      const ao = (a as AgentToolRun & { step_order?: number }).step_order ?? 0;
      const bo = (b as AgentToolRun & { step_order?: number }).step_order ?? 0;
      return ao - bo;
    }),
  }));

  return { workflows, standalone };
}

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  create_clickup_doc: "Create ClickUp Doc",
  create_clickup_task: "Create ClickUp Task",
  link_clickup_doc_to_task: "Link document to task",
  sync_clickup_docs: "Sync ClickUp Docs",
  sync_clickup_hierarchy: "Sync ClickUp Structure",
};

export function toolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName.replace(/_/g, " ");
}
