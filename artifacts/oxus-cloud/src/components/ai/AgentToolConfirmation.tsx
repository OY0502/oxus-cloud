import React, { useMemo, useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isActionableAgentToolRun, isStaleAgentToolRun } from "@/lib/agentToolRunUtils";
import {
  CLICKUP_DOC_MIN_CONTENT_LENGTH,
  destinationFromPayload,
  docContentFromPayload,
  docTitleFromPayload,
  isClickupDocContentValid,
  sourceContextFromPayload,
} from "@/lib/clickupDocTool";
import type { AgentToolRun } from "@/lib/types";
import {
  groupToolRunsByWorkflow,
  stepKeyFromRun,
  toolDisplayName,
  type WorkflowGroup,
} from "@/lib/workflowUtils";

type Props = {
  toolRuns: AgentToolRun[];
  busy?: boolean;
  onConfirm: (toolRun: AgentToolRun, overrides?: Record<string, unknown>) => Promise<void>;
  onCancel: (toolRun: AgentToolRun) => Promise<void>;
  onConfirmWorkflow?: (
    workflow: WorkflowGroup,
    stepOverrides: Record<string, Record<string, unknown>>,
  ) => Promise<void>;
  onCancelWorkflow?: (workflow: WorkflowGroup) => Promise<void>;
  agentRunId?: string;
};

export function AgentToolConfirmationList({
  toolRuns,
  busy,
  onConfirm,
  onCancel,
  onConfirmWorkflow,
  onCancelWorkflow,
  agentRunId,
}: Props) {
  const scoped = useMemo(
    () => (agentRunId ? toolRuns.filter((r) => r.agent_run_id === agentRunId) : toolRuns),
    [toolRuns, agentRunId],
  );

  const visible = useMemo(
    () => scoped.filter((r) => isActionableAgentToolRun(r) || r.status === "running"),
    [scoped],
  );

  const { workflows, standalone } = useMemo(() => groupToolRunsByWorkflow(visible), [visible]);

  if (visible.length === 0) return null;

  const failedCount = visible.filter((r) => r.status === "failed").length;
  const runningCount = visible.filter((r) => r.status === "running" && !isStaleAgentToolRun(r)).length;

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-foreground">
        {runningCount > 0
          ? "Tool actions in progress"
          : failedCount > 0
            ? "Confirmations & retries"
            : "Pending confirmations"}
      </p>

      {workflows.map((workflow) => (
        <WorkflowConfirmationGroup
          key={workflow.workflow_id}
          workflow={workflow}
          busy={busy}
          onConfirmWorkflow={onConfirmWorkflow}
          onCancelWorkflow={onCancelWorkflow}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ))}

      {standalone.map((run) => (
        <AgentToolConfirmationCard
          key={run.id}
          toolRun={run}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}

function WorkflowConfirmationGroup({
  workflow,
  busy,
  onConfirmWorkflow,
  onCancelWorkflow,
  onConfirm,
  onCancel,
}: {
  workflow: WorkflowGroup;
  busy?: boolean;
  onConfirmWorkflow?: Props["onConfirmWorkflow"];
  onCancelWorkflow?: Props["onCancelWorkflow"];
  onConfirm: Props["onConfirm"];
  onCancel: Props["onCancel"];
}) {
  const [stepOverrides, setStepOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const isRunning = workflow.runs.some((r) => r.status === "running" && !isStaleAgentToolRun(r));
  const isFailed = workflow.runs.some((r) => r.status === "failed");
  const canConfirmWorkflow = workflow.runs.every((r) => {
    if (r.status !== "needs_confirmation" && r.status !== "pending") return false;
    if (r.tool_name === "create_clickup_doc") {
      const content = docContentFromPayload((r.input_payload ?? {}) as Record<string, unknown>);
      const overrides = stepOverrides[stepKeyFromRun(r) ?? r.id];
      const merged = typeof overrides?.content_markdown === "string" ? overrides.content_markdown : content;
      return isClickupDocContentValid(merged);
    }
    if (r.tool_name === "create_clickup_task") {
      const title = docTitleFromPayload((r.input_payload ?? {}) as Record<string, unknown>);
      const overrides = stepOverrides[stepKeyFromRun(r) ?? r.id];
      const merged = typeof overrides?.title === "string" ? overrides.title : title;
      return merged.trim().length > 0;
    }
    return true;
  });

  const updateStep = (stepKey: string, overrides: Record<string, unknown>) => {
    setStepOverrides((prev) => ({ ...prev, [stepKey]: { ...prev[stepKey], ...overrides } }));
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{workflow.workflow_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {workflow.runs.length} steps — nothing runs in ClickUp until you confirm.
          </p>
        </div>
        {isRunning && <Loader2 className="h-4 w-4 animate-spin text-soft-violet shrink-0" />}
      </div>

      <div className="space-y-2">
        {workflow.runs.map((run, index) => (
          <AgentToolConfirmationCard
            key={run.id}
            toolRun={run}
            busy={busy}
            compact
            stepIndex={index + 1}
            stepKey={stepKeyFromRun(run) ?? undefined}
            hideActions
            onOverrideChange={(overrides) => {
              const key = stepKeyFromRun(run) ?? run.id;
              updateStep(key, overrides);
            }}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ))}
      </div>

      <div className="flex gap-2 justify-end pt-1 border-t border-border/40">
        {!isRunning && onCancelWorkflow && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1"
            disabled={busy}
            onClick={() => onCancelWorkflow(workflow)}
          >
            <X className="h-3.5 w-3.5" /> Cancel workflow
          </Button>
        )}
        {!isRunning && canConfirmWorkflow && onConfirmWorkflow && (
          <Button
            size="sm"
            className="h-8 gap-1"
            disabled={busy || !canConfirmWorkflow}
            onClick={() => onConfirmWorkflow(workflow, stepOverrides)}
          >
            {isFailed ? (
              <>
                <RefreshCw className="h-3.5 w-3.5" /> Retry workflow
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" /> Confirm workflow
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function AgentToolConfirmationCard({
  toolRun,
  busy,
  onConfirm,
  onCancel,
  compact,
  stepIndex,
  stepKey,
  hideActions,
  onOverrideChange,
}: {
  toolRun: AgentToolRun;
  busy?: boolean;
  onConfirm: Props["onConfirm"];
  onCancel: Props["onCancel"];
  compact?: boolean;
  stepIndex?: number;
  stepKey?: string;
  hideActions?: boolean;
  onOverrideChange?: (overrides: Record<string, unknown>) => void;
}) {
  const payload = (toolRun.input_payload ?? {}) as Record<string, unknown>;
  const [title, setTitle] = useState(() => docTitleFromPayload(payload));
  const [description, setDescription] = useState(() => docContentFromPayload(payload));
  const [dueDate, setDueDate] = useState(payloadField(payload, "due_date_hint") || payloadField(payload, "due_date"));
  const [priority, setPriority] = useState(payloadField(payload, "priority") || "medium");

  React.useEffect(() => {
    setTitle(docTitleFromPayload(payload));
    setDescription(docContentFromPayload(payload));
    setDueDate(payloadField(payload, "due_date_hint") || payloadField(payload, "due_date"));
    setPriority(payloadField(payload, "priority") || "medium");
  }, [toolRun.id, toolRun.status, toolRun.input_payload]);

  const emitOverrides = (next: Record<string, unknown>) => {
    onOverrideChange?.(next);
  };

  const isDoc = toolRun.tool_name === "create_clickup_doc";
  const isTask = toolRun.tool_name === "create_clickup_task";
  const isLink = toolRun.tool_name === "link_clickup_doc_to_task";
  const isFolderTool = [
    "create_clickup_folder",
    "rename_clickup_folder",
    "archive_clickup_folder",
    "create_clickup_list",
    "rename_clickup_list",
    "move_clickup_doc",
    "move_clickup_task",
  ].includes(toolRun.tool_name);
  const destination = destinationFromPayload(payload);
  const sourceContext = sourceContextFromPayload(payload);
  const isFailed = toolRun.status === "failed";
  const isRunning = toolRun.status === "running" && !isStaleAgentToolRun(toolRun);
  const isStaleRunning = toolRun.status === "running" && isStaleAgentToolRun(toolRun);
  const docContentMissing = isDoc && !isRunning && !isClickupDocContentValid(description);
  const docContentTooShort = isDoc && !isRunning && description.trim().length > 0 && !isClickupDocContentValid(description);
  const canConfirmDoc = !isDoc || isClickupDocContentValid(description);
  const canConfirmTask = !isTask || title.trim().length > 0;
  const canConfirm = canConfirmDoc && canConfirmTask;

  React.useEffect(() => {
    if (!onOverrideChange) return;
    if (isDoc) onOverrideChange({ title, content_markdown: description });
    else if (isTask) onOverrideChange({ title, description, due_date: dueDate || undefined, priority });
  }, [toolRun.id, title, description, dueDate, priority, isDoc, isTask, onOverrideChange]);

  const buildOverrides = (): Record<string, unknown> => {
    if (isDoc) return { title, content_markdown: description };
    if (isTask) return { title, description, due_date: dueDate || undefined, priority };
    return {};
  };

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        compact ? "border-border/60 bg-card/80" : ""
      } ${
        isFailed || isStaleRunning
          ? "border-destructive/30 bg-destructive/5"
          : isRunning
            ? "border-soft-violet/30 bg-soft-violet/5"
            : compact
              ? ""
              : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {stepIndex != null && <span className="text-muted-foreground mr-1.5">Step {stepIndex}.</span>}
          {toolDisplayName(toolRun.tool_name)}
        </p>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{toolRun.status.replace(/_/g, " ")}</span>
      </div>

      {isRunning && (
        <div className="flex gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 mt-0.5 animate-spin" />
          <p>Running… this usually takes a few seconds.</p>
        </div>
      )}
      {isStaleRunning && (
        <div className="flex gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p>This action appears stuck. Retry to run it directly.</p>
        </div>
      )}
      {(isFailed || isStaleRunning) && toolRun.error_message && (
        <div className="flex gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p className="whitespace-pre-wrap">{toolRun.error_message}</p>
        </div>
      )}

      {isLink && !isRunning && (
        <div className="text-sm space-y-2">
          <p className="text-muted-foreground">
            {String(payload.explanation ?? "Links the created doc to the task after both are created.")}
          </p>
          <div className="grid gap-2 text-xs rounded-md border border-border/60 bg-muted/20 p-2">
            <p>
              <span className="font-medium text-foreground">Doc ref:</span>{" "}
              {String(payload.doc_ref ?? payload.doc_url ?? "from previous step")}
            </p>
            <p>
              <span className="font-medium text-foreground">Task ref:</span>{" "}
              {String(payload.task_ref ?? payload.task_url ?? "from previous step")}
            </p>
            <p>
              <span className="font-medium text-foreground">Link method:</span>{" "}
              {String(payload.link_mode ?? "task_description").replace(/_/g, " ")}
            </p>
          </div>
        </div>
      )}

      {(isTask || isDoc) && !isRunning && (
        <>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              emitOverrides(isDoc ? { title: e.target.value, content_markdown: description } : { title: e.target.value, description });
            }}
            placeholder="Title"
            className="h-8 text-sm"
          />
          {isDoc && destination?.path && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs space-y-1">
              <p className="font-medium text-foreground">Suggested destination</p>
              <p className="text-muted-foreground">{destination.path}</p>
              {destination.reason && <p className="text-[10px] text-muted-foreground">{destination.reason}</p>}
            </div>
          )}
          {isDoc && sourceContext.request_text && (
            <p className="text-[10px] text-muted-foreground">
              Source: {sourceContext.request_text.slice(0, 160)}
              {sourceContext.request_text.length > 160 ? "…" : ""}
            </p>
          )}
          {isTask && destination?.path && (
            <p className="text-xs text-muted-foreground">Destination list: {destination.path}</p>
          )}
          {docContentMissing && (
            <div className="flex gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>Document content was not generated. Re-run the agent or paste markdown before confirming.</p>
            </div>
          )}
          <Textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              emitOverrides(
                isDoc
                  ? { title, content_markdown: e.target.value }
                  : { title, description: e.target.value, due_date: dueDate || undefined, priority },
              );
            }}
            rows={isDoc ? 8 : 3}
            placeholder={isDoc ? "Markdown document content" : "Description"}
            className={`text-sm ${docContentMissing ? "border-destructive/50" : ""}`}
          />
          {isDoc && (
            <p className={`text-[10px] ${docContentTooShort ? "text-amber-600" : "text-muted-foreground"}`}>
              {description.trim().length} characters
              {docContentTooShort && ` — minimum ${CLICKUP_DOC_MIN_CONTENT_LENGTH} required`}
            </p>
          )}
          {isTask && (
            <div className="flex flex-wrap gap-2">
              <Input
                type="date"
                value={dueDate.slice(0, 10)}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  emitOverrides({ title, description, due_date: e.target.value || undefined, priority });
                }}
                className="h-8 text-sm w-40"
              />
              <Input
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  emitOverrides({ title, description, due_date: dueDate || undefined, priority: e.target.value });
                }}
                placeholder="Priority"
                className="h-8 text-sm w-32"
              />
            </div>
          )}
        </>
      )}

      {isFolderTool && !isRunning && (
        <pre className="text-[10px] bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}

      {toolRun.trigger_run_id && (
        <p className="text-[10px] text-muted-foreground font-mono">trigger: {toolRun.trigger_run_id}</p>
      )}

      {!hideActions && (
        <div className="flex gap-2 justify-end">
          {!isRunning && (
            <Button size="sm" variant="ghost" className="h-7 gap-1" disabled={busy} onClick={() => onCancel(toolRun)}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
          {!isRunning && (
            <Button
              size="sm"
              className="h-7 gap-1"
              disabled={busy || !canConfirm}
              onClick={() => onConfirm(toolRun, buildOverrides())}
            >
              {isFailed || isStaleRunning ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" /> Confirm
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function payloadField(payload: Record<string, unknown>, key: string): string {
  const val = payload[key];
  return typeof val === "string" ? val : "";
}

type ProjectAgentRunResultDiagnostics = {
  model?: string;
  retrieval_mode?: "vector" | "fallback";
  chunks_retrieved_count?: number;
  trigger_run_id?: string;
  langfuse_trace_id?: string;
  langfuse_generation_id?: string;
  langfuse_trace_url?: string;
  langfuse_enabled?: boolean;
  langfuse_error?: string;
  clickup_hierarchy_last_synced?: string | null;
  clickup_folders_known?: number;
  clickup_lists_known?: number;
  clickup_docs_known?: number;
  clickup_doc_chunks_retrieved?: number;
  active_clickup_doc_sources?: number;
  excluded_out_of_scope_sources?: number;
  embeddings_enabled?: boolean;
  embedding_provider?: string;
  embedding_skip_reason?: string;
  trigger_enabled?: boolean;
  fallback_used?: boolean;
  runtime?: string;
  tool_calls_planned_count?: number;
  pending_tool_runs_count?: number;
  workflow_step_count?: number;
  clickup_connected?: boolean;
  total_tool_calls_planned?: number;
  safe_tool_calls_planned?: number;
  external_mutation_tool_calls_planned?: number;
  confirmation_required_tool_calls_planned?: number;
  tool_calls_created?: number;
  tool_calls_rejected?: number;
  rejected_tool_call_reasons?: Array<{ tool_name: string; reason: string }>;
  tool_validation_errors?: Array<{ tool_name: string; reason: string }>;
  proposed_tasks_created_count?: number;
  attention_reconciliation_ran?: boolean;
  attention_open_before?: number;
  attention_resolved_count?: number;
  attention_updated_count?: number;
  attention_kept_open_count?: number;
  attention_new_questions_count?: number;
  attention_resolved_item_ids?: string[];
  warnings?: string[];
};

export function AgentRunDiagnosticsPanel({
  diagnostics,
  agentRunId,
  agentRunStatus,
  triggerEnabled,
  triggerRunId,
  fallbackUsed,
  warning,
  toolRunIds,
  toolRunCounts,
  show,
  onToggle,
  onSyncHierarchy,
  syncingHierarchy,
}: {
  diagnostics?: ProjectAgentRunResultDiagnostics;
  agentRunId?: string;
  agentRunStatus?: string;
  triggerEnabled?: boolean;
  triggerRunId?: string | null;
  fallbackUsed?: boolean;
  warning?: string;
  toolRunIds?: string[];
  toolRunCounts?: { pending: number; confirmed: number; failed: number };
  show: boolean;
  onToggle: () => void;
  onSyncHierarchy?: () => void;
  syncingHierarchy?: boolean;
}) {
  if (!diagnostics && !agentRunId) return null;

  const resolvedTriggerRunId = triggerRunId ?? diagnostics?.trigger_run_id;
  const resolvedTriggerEnabled = triggerEnabled ?? diagnostics?.trigger_enabled;
  const resolvedFallback = fallbackUsed ?? diagnostics?.fallback_used;

  return (
    <div className="border-t border-border/40 pt-2">
      <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={onToggle}>
        {show ? "Hide diagnostics" : "Show diagnostics"}
      </button>
      {show && (
        <div className="mt-1 text-[10px] text-muted-foreground space-y-0.5 font-mono">
          {agentRunId && <p>agent_run_id: {agentRunId}</p>}
          {agentRunStatus && <p>status: {agentRunStatus}</p>}
          {resolvedTriggerEnabled != null && <p>trigger_enabled: {String(resolvedTriggerEnabled)}</p>}
          {resolvedTriggerRunId && <p>trigger_run_id: {resolvedTriggerRunId}</p>}
          {resolvedFallback != null && <p>fallback_used: {String(resolvedFallback)}</p>}
          {diagnostics?.runtime && <p>runtime: {diagnostics.runtime}</p>}
          {diagnostics?.model && <p>model: {diagnostics.model}</p>}
          {diagnostics?.langfuse_enabled != null && (
            <p>langfuse: {diagnostics.langfuse_enabled ? "enabled" : "disabled"}</p>
          )}
          {diagnostics?.langfuse_trace_id && <p>langfuse_trace: {diagnostics.langfuse_trace_id}</p>}
          {diagnostics?.langfuse_generation_id && (
            <p>langfuse_generation: {diagnostics.langfuse_generation_id}</p>
          )}
          {diagnostics?.total_tool_calls_planned != null ? (
            <p>
              tool_calls_planned: total={diagnostics.total_tool_calls_planned}, safe=
              {diagnostics.safe_tool_calls_planned ?? 0}, external_mutation=
              {diagnostics.external_mutation_tool_calls_planned ?? 0}, confirmation_required=
              {diagnostics.confirmation_required_tool_calls_planned ?? 0}
            </p>
          ) : diagnostics?.tool_calls_planned_count != null ? (
            <p>tool_calls_planned: {diagnostics.tool_calls_planned_count}</p>
          ) : null}
          {diagnostics?.tool_calls_created != null && (
            <p>tool_calls_created: {diagnostics.tool_calls_created}</p>
          )}
          {diagnostics?.tool_calls_rejected != null && diagnostics.tool_calls_rejected > 0 && (
            <p>tool_calls_rejected: {diagnostics.tool_calls_rejected}</p>
          )}
          {diagnostics?.proposed_tasks_created_count != null && diagnostics.proposed_tasks_created_count > 0 && (
            <p>proposed_tasks_created: {diagnostics.proposed_tasks_created_count}</p>
          )}
          {diagnostics?.attention_reconciliation_ran != null && (
            <p>attention_reconciliation_ran: {String(diagnostics.attention_reconciliation_ran)}</p>
          )}
          {diagnostics?.attention_reconciliation_ran && (
            <p>
              attention: open_before={diagnostics.attention_open_before ?? 0}, resolved=
              {diagnostics.attention_resolved_count ?? 0}, updated={diagnostics.attention_updated_count ?? 0}, kept_open=
              {diagnostics.attention_kept_open_count ?? 0}, new={diagnostics.attention_new_questions_count ?? 0}
            </p>
          )}
          {(diagnostics?.attention_resolved_item_ids ?? []).length > 0 && (
            <p>resolved_question_ids: {(diagnostics?.attention_resolved_item_ids ?? []).join(", ")}</p>
          )}
          {diagnostics?.pending_tool_runs_count != null && (
            <p>pending_tool_runs: {diagnostics.pending_tool_runs_count}</p>
          )}
          {(diagnostics?.rejected_tool_call_reasons ?? diagnostics?.tool_validation_errors ?? []).map((r, i) => (
            <p key={`rej-${i}`} className="text-amber-600">
              rejected {r.tool_name}: {r.reason}
            </p>
          ))}
          {toolRunCounts && (
            <p>
              tool_runs: pending={toolRunCounts.pending}, confirmed/running=
              {toolRunCounts.confirmed}, failed={toolRunCounts.failed}
            </p>
          )}
          {diagnostics?.workflow_step_count != null && (
            <p>workflow_step_count: {diagnostics.workflow_step_count}</p>
          )}
          {diagnostics?.retrieval_mode && (
            <p>
              retrieval: {diagnostics.retrieval_mode}
              {diagnostics.chunks_retrieved_count != null ? ` (${diagnostics.chunks_retrieved_count} chunks` : ""}
              {diagnostics.clickup_doc_chunks_retrieved != null
                ? `, ${diagnostics.clickup_doc_chunks_retrieved} clickup_doc)`
                : diagnostics.chunks_retrieved_count != null
                  ? ")"
                  : ""}
            </p>
          )}
          {diagnostics?.embeddings_enabled != null && (
            <p>
              embeddings: {diagnostics.embeddings_enabled ? "enabled" : "disabled"}
              {diagnostics.embedding_provider ? ` (${diagnostics.embedding_provider})` : ""}
            </p>
          )}
          {diagnostics?.embedding_skip_reason && (
            <p className="text-amber-600">{diagnostics.embedding_skip_reason} — using fallback retrieval.</p>
          )}
          {diagnostics?.excluded_out_of_scope_sources != null && diagnostics.excluded_out_of_scope_sources > 0 && (
            <p>excluded_out_of_scope_sources: {diagnostics.excluded_out_of_scope_sources}</p>
          )}
          {diagnostics?.clickup_hierarchy_last_synced && (
            <p>clickup_hierarchy_synced: {diagnostics.clickup_hierarchy_last_synced}</p>
          )}
          {(diagnostics?.clickup_folders_known != null ||
            diagnostics?.clickup_lists_known != null ||
            diagnostics?.clickup_docs_known != null) && (
            <p>
              clickup_known: folders={diagnostics.clickup_folders_known ?? 0}, lists=
              {diagnostics.clickup_lists_known ?? 0}, docs={diagnostics.clickup_docs_known ?? 0}
            </p>
          )}
          {diagnostics?.clickup_connected === false && (
            <p className="text-muted-foreground">
              ClickUp structure is unavailable because this project is not linked to ClickUp.
            </p>
          )}
          {toolRunIds && toolRunIds.length > 0 && (
            <p>tool_run_ids: {toolRunIds.join(", ")}</p>
          )}
          {diagnostics?.langfuse_trace_url && (
            <a
              href={diagnostics.langfuse_trace_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-soft-violet hover:underline"
            >
              Langfuse trace <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {diagnostics?.langfuse_error && <p className="text-amber-600">{diagnostics.langfuse_error}</p>}
          {onSyncHierarchy && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[10px] mt-1"
              disabled={syncingHierarchy}
              onClick={onSyncHierarchy}
            >
              {syncingHierarchy ? "Syncing…" : "Sync ClickUp structure"}
            </Button>
          )}
          {warning && <p className="text-amber-600">{warning}</p>}
          {diagnostics?.warnings?.map((w) => (
            <p key={w} className="text-amber-600">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
