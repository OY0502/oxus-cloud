import React, { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, FileText, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  uploadProjectAgentIntakeFile,
  useAgentToolRuns,
  useConfirmAgentToolRun,
  useConfirmAgentWorkflow,
  useProjectAgentRun,
  useProjectClickupLink,
  useRunProjectAgent,
  useSyncClickupProjectDocs,
  useSyncClickupProjectHierarchy,
  qk,
} from "@/hooks/api";
import type { ProjectAgentRunResult } from "@/lib/types";
import { AgentToolConfirmationList } from "./AgentToolConfirmation";
import { MemoryIntakeResultCard } from "./MemoryIntakeResultCard";
import { formatClickupDocSyncSummary } from "./clickupDocSyncUtils";
import type { WorkflowGroup } from "@/lib/workflowUtils";

const ACCEPTED_FILE_TYPES = ".txt,.md,.vtt,.srt,.csv,.json,.pdf,.doc,.docx";

type PendingIntakeFile = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(file: PendingIntakeFile): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop();
  return ext ? ext.toUpperCase() : "File";
}

function formatGenerationError(message: string): string {
  if (/idle timeout|504|gateway timeout/i.test(message)) {
    return "The AI request timed out. Try a shorter input, or paste a summary instead of the full recording.";
  }
  return message;
}

interface Props {
  projectId: string;
  onPrefill?: (text: string) => void;
  prefillText?: string;
  onProcessed?: () => void;
}

export function MemoryIntakePanel({ projectId, prefillText, onProcessed }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const runAgent = useRunProjectAgent();
  const confirmTool = useConfirmAgentToolRun();
  const confirmWorkflow = useConfirmAgentWorkflow();
  const syncClickupDocs = useSyncClickupProjectDocs();
  const syncClickupHierarchy = useSyncClickupProjectHierarchy();
  const { data: clickupLink } = useProjectClickupLink(projectId);

  const [inputText, setInputText] = useState(prefillText ?? "");
  const [pendingFiles, setPendingFiles] = useState<PendingIntakeFile[]>([]);
  const [lastResult, setLastResult] = useState<ProjectAgentRunResult | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const agentRunIdForPoll =
    lastResult?.async && (lastResult.status === "running" || lastResult.status === "pending")
      ? lastResult.agent_run_id
      : lastResult?.agent_run_id;

  const { data: toolRuns = [] } = useAgentToolRuns(projectId);
  const { data: polledRun } = useProjectAgentRun(agentRunIdForPoll);

  const toolRunsForCurrentRun = useMemo(() => {
    if (!lastResult?.agent_run_id) return [];
    return toolRuns.filter((r) => r.agent_run_id === lastResult.agent_run_id);
  }, [toolRuns, lastResult?.agent_run_id]);

  const toolRunCounts = useMemo(() => {
    const runs = toolRunsForCurrentRun;
    return {
      pending: runs.filter((r) => r.status === "needs_confirmation" || r.status === "pending").length,
      confirmed: runs.filter((r) => ["confirmed", "running", "succeeded"].includes(r.status)).length,
      failed: runs.filter((r) => r.status === "failed").length,
    };
  }, [toolRunsForCurrentRun]);

  const plannedToolsWarning = useMemo(() => {
    if (!lastResult || (lastResult.async && (polledRun?.status === "running" || polledRun?.status === "pending"))) {
      return null;
    }
    const d = lastResult.diagnostics;
    // Only a confirmation-required EXTERNAL MUTATION (create ClickUp task/doc, folder ops)
    // should ever produce a confirmation card. Safe/read-only/internal tools must not warn.
    const externalMutationsPlanned =
      d?.external_mutation_tool_calls_planned ??
      d?.confirmation_required_tool_calls_planned ??
      0;
    const rejected = d?.tool_calls_rejected ?? 0;
    const pending = toolRunCounts.pending;

    // A validation/execution rejection already explains why nothing was created —
    // diagnostics shows the exact reason, so don't show the generic warning too.
    if (externalMutationsPlanned > 0 && pending === 0 && toolRunsForCurrentRun.length === 0 && rejected === 0) {
      return "The agent planned an external action, but no confirmation was created. Please check diagnostics.";
    }
    return null;
  }, [lastResult, polledRun?.status, toolRunCounts.pending, toolRunsForCurrentRun.length]);

  React.useEffect(() => {
    if (!polledRun || !lastResult) return;
    if (polledRun.status === "running" || polledRun.status === "pending") return;

    // Background (Trigger.dev) runs finish reconciliation after the mutation returned,
    // so refetch attention items/tasks/profile once the run reaches a terminal state.
    qc.invalidateQueries({ queryKey: qk.projectPmAttentionItems(projectId) });
    qc.invalidateQueries({ queryKey: qk.aiProposedTasks(projectId) });
    qc.invalidateQueries({ queryKey: qk.projectPmProfile(projectId) });

    const raw = polledRun.raw_response as {
      answer?: string | null;
      confidence?: number;
    } | null;
    const diag = (polledRun.diagnostics ?? {}) as ProjectAgentRunResult["diagnostics"];

    setLastResult((prev) =>
      prev
        ? {
            ...prev,
            status: polledRun.status,
            result_summary: polledRun.result_summary ?? prev.result_summary,
            answer: raw?.answer ?? prev.answer,
            clarification_questions: (polledRun.clarification_questions as ProjectAgentRunResult["clarification_questions"]) ?? prev.clarification_questions,
            tool_run_ids: polledRun.tool_run_ids ?? prev.tool_run_ids,
            created_task_ids: polledRun.created_task_ids ?? prev.created_task_ids,
            trigger_run_id: polledRun.trigger_run_id ?? prev.trigger_run_id,
            confidence: raw?.confidence ?? prev.confidence,
            diagnostics: { ...prev.diagnostics, ...diag },
            async: false,
          }
        : prev,
    );
  }, [polledRun, lastResult?.agent_run_id]);

  React.useEffect(() => {
    if (prefillText) setInputText(prefillText);
  }, [prefillText]);

  const clearInput = () => {
    setInputText("");
    setPendingFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFileSelected = (file: File | undefined) => {
    if (!file) return;
    setPendingFiles((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
      },
    ]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const process = async () => {
    const text = inputText.trim();
    if (!text && pendingFiles.length === 0) return;

    try {
      const uploadedFileIds: string[] = [];
      for (const pending of pendingFiles) {
        const attachmentId = await uploadProjectAgentIntakeFile(projectId, pending.file);
        uploadedFileIds.push(attachmentId);
      }

      const result = await runAgent.mutateAsync({
        project_id: projectId,
        input_text: text,
        uploaded_file_ids: uploadedFileIds,
        mode: "auto",
      });

      clearInput();
      setLastResult(result);
      setShowDiagnostics(false);
      onProcessed?.();

      toast({
        title: result.async ? "Agent run queued" : "Agent completed",
        description: result.result_summary ?? "Project agent processed your request.",
      });
    } catch (e) {
      const message = formatGenerationError((e as Error).message);
      toast({ title: "Processing failed", description: message, variant: "destructive" });
    }
  };

  const confirmToolRun = async (toolRun: { id: string; status?: string }, overrides?: Record<string, unknown>) => {
    const isRetry = toolRun.status === "failed" || toolRun.status === "running";
    try {
      const result = await confirmTool.mutateAsync({
        project_id: projectId,
        tool_run_id: toolRun.id,
        input_payload_overrides: overrides,
      });
      if (result?.async) {
        toast({
          title: "Running",
          description: "Tool is executing in the background. Status will update here when done.",
        });
        return;
      }
      toast({
        title: isRetry ? "Retry succeeded" : "Confirmed",
        description: "Tool executed successfully.",
      });
    } catch (e) {
      toast({ title: isRetry ? "Retry failed" : "Confirmation failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const cancelToolRun = async (toolRun: { id: string }) => {
    try {
      await confirmTool.mutateAsync({ project_id: projectId, tool_run_id: toolRun.id, cancel: true });
    } catch (e) {
      toast({ title: "Cancel failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const confirmWorkflowRun = async (
    workflow: WorkflowGroup,
    stepOverrides: Record<string, Record<string, unknown>>,
  ) => {
    try {
      const result = await confirmWorkflow.mutateAsync({
        project_id: projectId,
        workflow_id: workflow.workflow_id,
        step_overrides: stepOverrides,
      });
      if (result?.async) {
        toast({
          title: "Workflow running",
          description: "Steps are executing in order via Trigger.dev. Status updates appear below.",
        });
        return;
      }
      toast({ title: "Workflow completed", description: "All steps finished successfully." });
    } catch (e) {
      toast({ title: "Workflow failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const cancelWorkflowRun = async (workflow: WorkflowGroup) => {
    try {
      await confirmWorkflow.mutateAsync({
        project_id: projectId,
        workflow_id: workflow.workflow_id,
        cancel: true,
      });
    } catch (e) {
      toast({ title: "Cancel failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy =
    runAgent.isPending ||
    confirmTool.isPending ||
    confirmWorkflow.isPending ||
    syncClickupDocs.isPending ||
    syncClickupHierarchy.isPending;
  const canProcess = inputText.trim().length > 0 || pendingFiles.length > 0;

  return (
    <div className="rounded-xl border border-soft-violet/25 bg-soft-violet/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-foreground">Memory Intake</h4>
      </div>

      <p className="text-xs text-muted-foreground">
        Ask the project agent to update memory, generate tasks, create ClickUp docs, or answer from project context.
      </p>

      <Textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        rows={5}
        placeholder="Ask a question, paste notes, or request a ClickUp task or doc…"
        className="text-sm"
      />

      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pendingFiles.map((pending) => (
            <div
              key={pending.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs"
            >
              <FileText className="h-3.5 w-3.5 text-soft-violet shrink-0" />
              <div className="min-w-0">
                <p className="font-medium truncate max-w-[180px]">{pending.name}</p>
                <p className="text-muted-foreground">
                  {fileTypeLabel(pending)} · {formatFileSize(pending.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => removePendingFile(pending.id)}
                disabled={busy}
                aria-label={`Remove ${pending.name}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={(e) => onFileSelected(e.target.files?.[0])}
        />
        <Button variant="outline" size="sm" className="gap-1 h-8" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="h-3.5 w-3.5" /> Upload file
        </Button>
        {clickupLink && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-8"
              disabled={busy}
              onClick={async () => {
                try {
                  const r = await syncClickupHierarchy.mutateAsync({ project_id: projectId, force: true });
                  toast({
                    title: "ClickUp structure synced",
                    description: `${r.folders_synced} folders, ${r.lists_synced} lists, ${r.docs_synced} docs.`,
                  });
                } catch (e) {
                  toast({ title: "Hierarchy sync failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              Sync ClickUp structure
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-8"
              disabled={busy}
              onClick={async () => {
                try {
                  const r = await syncClickupDocs.mutateAsync(projectId);
                  toast({
                    title: r.async ? "ClickUp docs sync queued" : "ClickUp docs synced",
                    description: formatClickupDocSyncSummary(r),
                  });
                  if (!r.async && ((r.docs_imported ?? 0) + (r.docs_updated ?? 0) > 0 || (r.docs_marked_out_of_scope ?? 0) > 0)) {
                    onProcessed?.();
                  }
                } catch (e) {
                  toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              Sync ClickUp Docs
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 h-8"
          onClick={clearInput}
          disabled={(!inputText && pendingFiles.length === 0) || busy}
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={process}
          disabled={!canProcess || busy}
          className="gap-1 bg-soft-violet hover:bg-soft-violet/90 text-white border-0"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {runAgent.isPending ? "Processing…" : "Ask / update memory"}
        </Button>
      </div>

      {lastResult && (
        <div className="space-y-3 pt-1">
          <MemoryIntakeResultCard
            result={lastResult}
            polledStatus={polledRun?.status}
            polledTriggerRunId={polledRun?.trigger_run_id}
            toolRunsForRun={toolRunCounts}
            showDiagnostics={showDiagnostics}
            onToggleDiagnostics={() => setShowDiagnostics((v) => !v)}
            onClear={() => {
              setLastResult(null);
              setShowDiagnostics(false);
            }}
            plannedToolsWarning={plannedToolsWarning}
            onSyncHierarchy={
              clickupLink
                ? async () => {
                    try {
                      const r = await syncClickupHierarchy.mutateAsync({ project_id: projectId, force: true });
                      toast({
                        title: "ClickUp structure synced",
                        description: `${r.folders_synced} folders, ${r.lists_synced} lists, ${r.docs_synced} docs.`,
                      });
                    } catch (e) {
                      toast({
                        title: "Hierarchy sync failed",
                        description: (e as Error).message,
                        variant: "destructive",
                      });
                    }
                  }
                : undefined
            }
            syncingHierarchy={syncClickupHierarchy.isPending}
          />

          <AgentToolConfirmationList
            toolRuns={toolRuns}
            agentRunId={lastResult.agent_run_id}
            busy={busy}
            onConfirm={confirmToolRun}
            onCancel={cancelToolRun}
            onConfirmWorkflow={confirmWorkflowRun}
            onCancelWorkflow={cancelWorkflowRun}
          />
        </div>
      )}

      {runAgent.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Processing failed</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">
            {formatGenerationError(runAgent.error.message)}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
