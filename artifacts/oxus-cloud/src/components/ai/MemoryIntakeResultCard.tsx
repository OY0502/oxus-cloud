import React from "react";
import { Copy, ExternalLink, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusVariant } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import type { AgentRunStatus, ProjectAgentRunResult } from "@/lib/types";
import { AgentRunDiagnosticsPanel } from "./AgentToolConfirmation";

function statusVariant(status?: AgentRunStatus): StatusVariant {
  if (!status) return "neutral";
  if (status === "succeeded" || status === "confirmed") return "success";
  if (status === "needs_confirmation") return "warning";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "pending") return "info";
  if (status === "needs_clarification") return "warning";
  return "neutral";
}

function statusLabel(status?: AgentRunStatus, asyncRunning?: boolean): string {
  if (asyncRunning) return "processing";
  if (!status) return "unknown";
  return status.replace(/_/g, " ");
}

function formatResponseText(text: string): React.ReactNode {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  if (blocks.length <= 1 && !text.includes("\n- ")) {
    return <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{text}</p>;
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^[-*•]\s/.test(l.trim()) || l.trim() === "");
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {lines.filter((l) => l.trim()).map((l) => (
                <li key={l}>{l.replace(/^[-*•]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={i} className="whitespace-pre-wrap">{block}</p>;
      })}
    </div>
  );
}

type Props = {
  result: ProjectAgentRunResult;
  polledStatus?: AgentRunStatus;
  polledTriggerRunId?: string | null;
  toolRunsForRun?: { pending: number; confirmed: number; failed: number };
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
  onClear: () => void;
  onSyncHierarchy?: () => void;
  syncingHierarchy?: boolean;
  plannedToolsWarning?: string | null;
};

export function MemoryIntakeResultCard({
  result,
  polledStatus,
  polledTriggerRunId,
  toolRunsForRun,
  showDiagnostics,
  onToggleDiagnostics,
  onClear,
  onSyncHierarchy,
  syncingHierarchy,
  plannedToolsWarning,
}: Props) {
  const { toast } = useToast();
  const status = polledStatus ?? result.status;
  const asyncRunning = result.async && (status === "running" || status === "pending");
  const responseText = result.answer ?? result.result_summary ?? "";
  const confidence = (result.diagnostics as { confidence?: number } | undefined)?.confidence ?? result.confidence;
  const triggerRunId = polledTriggerRunId ?? result.trigger_run_id ?? result.diagnostics?.trigger_run_id;

  const copyResult = async () => {
    if (!responseText) return;
    try {
      await navigator.clipboard.writeText(responseText);
      toast({ title: "Copied", description: "AI result copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <Card className="border-soft-violet/30 bg-card shadow-soft">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-soft-violet" />
            <CardTitle className="text-base">AI result</CardTitle>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={statusLabel(status, asyncRunning)} variant={statusVariant(status)} />
            {typeof confidence === "number" && (
              <span className="text-xs text-muted-foreground">
                confidence {Math.round(confidence * 100)}%
              </span>
            )}
          </div>
        </div>
        {asyncRunning && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Agent run in progress…
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {responseText ? (
          formatResponseText(responseText)
        ) : (
          <p className="text-sm text-muted-foreground">No response text returned.</p>
        )}

        {(result.created_task_ids?.length ?? 0) > 0 && (
          <p className="text-sm text-muted-foreground">
            {result.created_task_ids!.length} proposed task(s) added for PM review.
          </p>
        )}

        {(result.clarification_questions?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
            <p className="text-xs font-medium text-foreground">Clarifications</p>
            <ul className="text-sm text-foreground/90 list-disc pl-4 space-y-1">
              {result.clarification_questions!.map((q) => (
                <li key={q.question}>{q.question}</li>
              ))}
            </ul>
          </div>
        )}

        {plannedToolsWarning && (
          <p className="text-sm text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            {plannedToolsWarning}
          </p>
        )}

        {(result.diagnostics?.model || triggerRunId || result.diagnostics?.chunks_retrieved_count != null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
            {result.diagnostics?.model && <span>Model: {result.diagnostics.model}</span>}
            {result.diagnostics?.chunks_retrieved_count != null && (
              <span>Sources: {result.diagnostics.chunks_retrieved_count} chunks</span>
            )}
            {triggerRunId && <span className="font-mono">Trigger: {triggerRunId.slice(0, 12)}…</span>}
            {result.diagnostics?.langfuse_trace_url && (
              <a
                href={result.diagnostics.langfuse_trace_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-soft-violet hover:underline"
              >
                Langfuse trace <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onToggleDiagnostics}>
          {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
        </Button>
        {responseText && (
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={copyResult}>
            <Copy className="h-3.5 w-3.5" /> Copy result
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 ml-auto" onClick={onClear}>
          <Trash2 className="h-3.5 w-3.5" /> Clear result
        </Button>
      </CardFooter>

      {showDiagnostics && (
        <div className="px-6 pb-4">
          <AgentRunDiagnosticsPanel
            diagnostics={{
              ...result.diagnostics,
              tool_calls_planned_count: result.diagnostics?.tool_calls_planned_count,
              pending_tool_runs_count: toolRunsForRun?.pending ?? result.diagnostics?.pending_tool_runs_count,
              workflow_step_count: result.diagnostics?.workflow_step_count,
            }}
            agentRunId={result.agent_run_id}
            agentRunStatus={status}
            triggerEnabled={result.trigger_enabled}
            triggerRunId={triggerRunId}
            fallbackUsed={result.fallback_used}
            warning={result.warning}
            toolRunIds={result.tool_run_ids}
            toolRunCounts={toolRunsForRun}
            show
            onToggle={onToggleDiagnostics}
            onSyncHierarchy={onSyncHierarchy}
            syncingHierarchy={syncingHierarchy}
          />
        </div>
      )}
    </Card>
  );
}
