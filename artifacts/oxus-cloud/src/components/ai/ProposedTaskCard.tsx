import React, { useState } from "react";
import { Check, ChevronDown, ChevronUp, ExternalLink, Figma, ListPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AiProposedTask, AiProposedTaskStatus } from "@/lib/types";

function statusVariant(status: AiProposedTaskStatus) {
  if (status === "accepted") return "default";
  if (status === "rejected") return "destructive";
  return "outline";
}

function sourceBadge(task: AiProposedTask): React.ReactNode {
  if (task.figma_file_key) return <Badge variant="secondary" className="text-[10px] h-5">Figma</Badge>;
  if (task.source_knowledge_source_id) return <Badge variant="secondary" className="text-[10px] h-5">Transcript</Badge>;
  return null;
}

function descriptionPreview(text: string | null, max = 160): string | null {
  if (!text?.trim()) return null;
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

interface Props {
  task: AiProposedTask;
  projectId: string;
  teamId?: string;
  onReject: (task: AiProposedTask) => void;
  onCreateTask: (
    task: AiProposedTask,
    options: {
      title: string;
      description?: string;
      priority: AiProposedTask["priority"];
      status?: string;
      assignee_ids: string[];
      due_date?: string;
      time_estimate_minutes?: number;
    },
  ) => Promise<void>;
  onOpenCreateClickup: (task: AiProposedTask) => void;
  busy: boolean;
}

export function ProposedTaskCard({
  task,
  onReject,
  onOpenCreateClickup,
  busy,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isSynced = !!(task.clickup_task_id || task.clickup_sync_status === "synced");
  const isSyncing = task.clickup_sync_status === "syncing";
  const isSyncError = task.clickup_sync_status === "error";
  const preview = descriptionPreview(task.description);
  const source = sourceBadge(task);
  const hasDetails =
    !!task.description ||
    task.acceptance_criteria.length > 0 ||
    task.qa_scenarios.length > 0 ||
    task.implementation_notes.length > 0 ||
    task.design_notes.length > 0 ||
    !!task.design_url;

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-soft p-3 space-y-2">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap pr-2">
          <h5 className="text-sm font-semibold leading-tight">{task.title}</h5>
          <Badge variant="outline" className="capitalize text-[10px] h-5">{task.priority}</Badge>
          <Badge variant={statusVariant(task.status)} className="capitalize text-[10px] h-5">{task.status}</Badge>
          {source}
          {isSynced && (
            <Badge variant="default" className="gap-0.5 text-[10px] h-5">
              <Check className="h-2.5 w-2.5" /> ClickUp
            </Badge>
          )}
          {isSyncError && <Badge variant="destructive" className="text-[10px] h-5">Sync failed</Badge>}
        </div>
        <p className="text-xs text-cool-slate">
          {task.confidence === null ? "Confidence n/a" : `${Math.round(task.confidence * 100)}% confidence`}
          {task.estimate_hours !== null && ` · ${task.estimate_hours}h est.`}
        </p>
        {preview && !detailsOpen && (
          <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p>
        )}
        {task.clickup_task_url && (
          <a
            href={task.clickup_task_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open in ClickUp <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {isSyncError && task.clickup_sync_error && (
          <p className="text-xs text-destructive line-clamp-2">{task.clickup_sync_error}</p>
        )}
      </div>

      {hasDetails && (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground">
              {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {detailsOpen ? "Hide details" : "Show details"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2 border-t border-border/60">
            {task.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
            )}
            {task.design_url && (
              <a href={task.design_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <Figma className="h-3.5 w-3.5" /> Design link <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {task.acceptance_criteria.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Acceptance criteria</p>
                <ul className="space-y-1">
                  {task.acceptance_criteria.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground pl-3 border-l-2 border-border/60">{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {task.qa_scenarios.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">QA scenarios</p>
                <div className="space-y-2">
                  {task.qa_scenarios.map((scenario, i) => (
                    <div key={i} className="rounded-md border border-border/60 bg-muted/20 p-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium">{scenario.title}</span>
                        <Badge variant="outline" className="capitalize text-[10px]">{scenario.priority}</Badge>
                      </div>
                      {scenario.steps.length > 0 && (
                        <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-0.5">
                          {scenario.steps.map((step, si) => <li key={si}>{step}</li>)}
                        </ol>
                      )}
                      {scenario.expected_result && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-medium">Expected:</span> {scenario.expected_result}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {task.implementation_notes.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Implementation notes</p>
                <ul className="space-y-1">
                  {task.implementation_notes.map((n, i) => (
                    <li key={i} className="text-sm text-muted-foreground">{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {task.design_notes.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Design notes</p>
                <ul className="space-y-1">
                  {task.design_notes.map((n, i) => (
                    <li key={i} className="text-sm text-muted-foreground">{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="flex justify-end gap-2 pt-1 border-t border-border/40">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 h-8 text-xs text-muted-foreground"
          onClick={() => onReject(task)}
          disabled={busy || task.status === "rejected"}
        >
          <X className="h-3 w-3" /> Reject
        </Button>
        <Button
          size="sm"
          variant={isSynced ? "default" : "outline"}
          className="gap-1 h-8 text-xs"
          onClick={() => onOpenCreateClickup(task)}
          disabled={busy || isSynced || isSyncing}
        >
          <ListPlus className="h-3 w-3" />
          {isSyncing ? "Syncing…" : isSynced ? "Synced" : "Create in ClickUp"}
        </Button>
      </div>
    </div>
  );
}
