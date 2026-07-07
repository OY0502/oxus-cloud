import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BrainCircuit,
  Check,
  CircleSlash,
  ClipboardCopy,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CreateClickupTaskFromPmActionDialog } from "@/components/clickup/CreateClickupTaskFromPmActionDialog";
import { ExecutePmActionDialog } from "@/components/pm/ExecutePmActionDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PmActionSourceContext } from "@/components/pm/PmActionSourceContext";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  useClickupMyConnection,
  useClickupTaskLinks,
  useCreateClickupTaskFromPmAction,
  useExecutePmAction,
  useGenerateProjectStatusReport,
  useLatestProjectAiStatusReport,
  useProjectClickupLink,
  useProjectPmActionItems,
  useProjectSlackPipelineDiagnostics,
  useStartClickupOAuth,
  useUpdateProjectPmActionItemStatus,
  useDedupePmActionItems,
} from "@/hooks/api";
import { useClickupOAuthHandler } from "@/hooks/useClickupOAuthHandler";
import {
  consumeClickupOAuthReturnIntent,
  projectClickupOAuthReturnPath,
  saveClickupOAuthReturnIntent,
  clearClickupOAuthReturnIntent,
  stripClickupConnectedSearchParam,
} from "@/lib/clickupOAuthReturn";
import {
  isPmActionClickupTaskCandidate,
  isRepeatedBlockerAction,
  pmActionClickupSynced,
} from "@/lib/pmActions";
import type {
  AiProcessingJob,
  ProcessAiJobsResult,
  ProjectAiStatusReport,
  ProjectPmActionItem,
  ProjectPmActionType,
  ProjectSignal,
  ProjectSignalThread,
  ProjectSlackEvent,
  SuppressionReasonEntry,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ActionListFilter = "open" | "resolved";

function confidenceLabel(confidence: number | null | undefined) {
  return typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : "n/a";
}

function badgeVariant(value: string | null | undefined) {
  if (value === "off-track" || value === "high" || value === "urgent") return "destructive" as const;
  if (value === "at-risk" || value === "medium") return "secondary" as const;
  return "outline" as const;
}

function SectionList({ items, empty = "No items." }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`} className="text-sm text-muted-foreground leading-relaxed">
          <span className="text-foreground">•</span> {item}
        </li>
      ))}
    </ul>
  );
}

function ReportSections({ report }: { report: ProjectAiStatusReport }) {
  const sections = [
    { id: "changed", title: "What Changed", items: report.what_changed },
    { id: "blockers", title: "Blockers", items: report.blockers, empty: "No blockers found." },
    { id: "risks", title: "Risks", items: report.risks, empty: "No new risks found." },
    { id: "questions", title: "Open Questions", items: report.open_questions, empty: "No open questions." },
    { id: "scope", title: "Scope Changes", items: report.scope_changes, empty: "No scope changes detected." },
    { id: "client", title: "Client Updates", items: report.client_updates, empty: "No client-facing updates." },
  ];

  return (
    <Accordion type="multiple" defaultValue={["changed", "blockers", "actions"]} className="rounded-lg border border-border">
      {sections.map((section) => (
        <AccordionItem key={section.id} value={section.id} className="px-3">
          <AccordionTrigger className="py-2 text-sm hover:no-underline">
            <span className="flex items-center gap-2">
              {section.title}
              {section.items.length > 0 && (
                <Badge variant={section.id === "blockers" || section.id === "risks" ? "secondary" : "outline"} className="h-5 text-[10px]">
                  {section.items.length}
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <SectionList items={section.items} empty={section.empty} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function priorityRank(priority: ProjectPmActionItem["priority"]) {
  const ranks: Record<ProjectPmActionItem["priority"], number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return ranks[priority];
}

function buildAccessRequestCopy(
  item: ProjectPmActionItem,
  taskLinks: Array<{ clickup_task_id: string; clickup_task_name: string | null; clickup_task_url: string | null }>,
): string {
  const resource =
    item.blocker_resource ??
    (typeof item.action_payload?.system_name === "string" ? item.action_payload.system_name : null) ??
    "the required system";
  const actor = item.blocked_actor_name?.trim() || "the assigned developer";
  const actorFirst = actor.split(" ")[0] ?? "They";
  const taskTitle =
    item.related_clickup_task_titles?.[0] ??
    (() => {
      const taskId = item.related_clickup_task_ids?.[0] ?? item.action_payload?.clickup_task_ids?.[0];
      const task = taskId ? taskLinks.find((link) => link.clickup_task_id === taskId) : undefined;
      return task?.clickup_task_name ?? null;
    })();
  const taskSentence = taskTitle ? ` for the task "${taskTitle}"` : "";
  return [
    `Could you please grant ${actor} access to ${resource}${taskSentence}?`,
    "",
    `${actorFirst} is currently blocked and cannot continue until access is provided.`,
  ].join("\n");
}

function isAccessBlocker(item: ProjectPmActionItem) {
  return item.blocker_type === "access" || item.category === "access_needed" || item.action_type === "request_access";
}

function copyText(text: string) {
  return navigator.clipboard.writeText(text);
}

function categoryLabel(category: ProjectPmActionItem["category"]) {
  if (category === "access_needed") return "Access Needed";
  return category.replace(/_/g, " ");
}

function primaryActionLabel(actionType: ProjectPmActionType | undefined, item: ProjectPmActionItem): string | null {
  if (isAccessBlocker(item)) return "Resolve blocker";
  switch (actionType) {
    case "assign_clickup_tasks":
      return "Assign resources";
    case "update_clickup_deadline":
      return "Set deadline";
    case "add_clickup_comment":
      return "Comment in ClickUp";
    case "create_clickup_task":
      return "Create task(s) in ClickUp";
    case "ask_client_question":
      return "Copy question";
    default:
      return null;
  }
}

function shouldShowMarkDone(item: ProjectPmActionItem, executable: boolean, accessBlocker: boolean) {
  if (accessBlocker) return false;
  const actionType = item.action_type ?? "manual";
  if (actionType === "ask_client_question") return true;
  if (actionType === "create_clickup_task" || isPmActionClickupTaskCandidate(item)) return true;
  if (!executable) return true;
  return false;
}

function DismissButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={disabled} onClick={onClick}>
      <CircleSlash className="h-3 w-3" /> Dismiss
    </Button>
  );
}

type StoredConversationGroup = {
  group_id?: string;
  task?: string | null;
  task_title?: string | null;
  clickup_task_id?: string | null;
  thread_id?: string | null;
  clickup_thread_id?: string | null;
  net_state?: string;
  reason?: string;
  net_state_reason?: string;
  latest_comment?: string;
  latest_comment_text?: string;
  resolving_comment?: string | null;
  resolving_comment_text?: string | null;
  topic_keywords?: string[];
  events?: Array<{
    created_at?: string;
    comment_text?: string;
    request_signal?: { kind?: string; reason?: string } | null;
    resolution_signal?: { reason?: string } | null;
  }>;
};

function normalizeDiagnosticGroup(group: StoredConversationGroup) {
  const netState = group.net_state ?? "unclear";
  const reason = (group.net_state_reason ?? group.reason ?? "").trim();
  const taskTitle =
    group.task_title ?? group.task ?? (group.clickup_task_id ? `Task ${group.clickup_task_id}` : null);
  const threadId = group.clickup_thread_id ?? group.thread_id ?? null;
  const latestComment = (group.latest_comment_text ?? group.latest_comment ?? "").trim();
  const resolvingComment = (group.resolving_comment_text ?? group.resolving_comment ?? "").trim();
  const events = group.events ?? [];
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const signalType =
    latestEvent?.request_signal?.kind ??
    (latestEvent?.resolution_signal ? "resolved" : null);
  const timestamp = latestEvent?.created_at ?? null;
  const hasContent = Boolean(reason || taskTitle || latestComment || resolvingComment || events.length > 0);

  return {
    groupId: group.group_id ?? threadId ?? taskTitle ?? "unknown",
    source: "ClickUp" as const,
    netState,
    reason,
    taskTitle,
    threadId,
    latestComment,
    resolvingComment,
    signalType,
    timestamp,
    topicKeywords: group.topic_keywords ?? [],
    hasContent,
  };
}

function diagnosticStateLabel(netState: string) {
  if (netState === "resolved_issue") return "Resolved";
  if (netState === "open_issue") return "Open";
  if (netState === "informational") return "Informational";
  return "Unclear";
}

function DiagnosticConversationRow({
  group,
}: {
  group: ReturnType<typeof normalizeDiagnosticGroup>;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/10 p-2.5 text-xs space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] h-5">
          {group.source}
        </Badge>
        <Badge variant="outline" className="text-[10px] h-5 capitalize">
          {diagnosticStateLabel(group.netState)}
        </Badge>
        {group.signalType && (
          <Badge variant="secondary" className="text-[10px] h-5 capitalize">
            {group.signalType.replace(/_/g, " ")}
          </Badge>
        )}
        {group.timestamp && (
          <span className="text-muted-foreground">
            {formatDistanceToNow(new Date(group.timestamp), { addSuffix: true })}
          </span>
        )}
      </div>
      {group.taskTitle && <p className="font-medium">{group.taskTitle}</p>}
      {group.threadId && (
        <p className="font-mono text-[10px] text-muted-foreground">Thread {group.threadId}</p>
      )}
      {group.reason && <p className="text-muted-foreground">{group.reason}</p>}
      {group.latestComment && (
        <p className="text-muted-foreground line-clamp-3">
          Latest: &ldquo;{group.latestComment}&rdquo;
        </p>
      )}
      {group.resolvingComment && (
        <p className="text-muted-foreground line-clamp-3">
          Resolution: &ldquo;{group.resolvingComment}&rdquo;
        </p>
      )}
      {group.topicKeywords.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Topics: {group.topicKeywords.slice(0, 6).join(", ")}
        </p>
      )}
    </div>
  );
}

function formatJobReasons(reasons: string[]) {
  if (reasons.length === 0) return "none";
  return reasons.join(", ");
}

function SlackDiagnosticsSection({
  projectId,
  slackPipeline,
  onCleanDuplicates,
  cleanDuplicatesBusy,
}: {
  projectId: string;
  slackPipeline: ProcessAiJobsResult | null;
  onCleanDuplicates?: () => void;
  cleanDuplicatesBusy?: boolean;
}) {
  const { data, isLoading, isError, error } = useProjectSlackPipelineDiagnostics(projectId);

  return (
    <div className="space-y-3">
      <h5 className="text-[11px] font-semibold uppercase tracking-wider text-cool-slate">
        Slack Pipeline
      </h5>
      {slackPipeline && (
        <div className="rounded-md border border-border/70 bg-background/40 p-2 text-xs space-y-1">
          <p className="font-medium">Last analyze run</p>
          <p className="text-muted-foreground">
            Processed {slackPipeline.processed_count} job(s), created {slackPipeline.actions_created_count}{" "}
            action(s), updated {slackPipeline.actions_updated_count ?? 0}, suppressed{" "}
            {slackPipeline.actions_suppressed_count ?? 0}, duplicates avoided{" "}
            {slackPipeline.duplicates_avoided ?? 0}.
          </p>
          {(slackPipeline.signals_new != null || slackPipeline.signals_already_processed != null) && (
            <p className="text-muted-foreground">
              Signals: {slackPipeline.signals_new ?? 0} new, {slackPipeline.signals_already_processed ?? 0}{" "}
              already processed.
            </p>
          )}
          {(slackPipeline.suppression_reasons?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1">
              <p className="font-medium">Suppressed by dismissed actions</p>
              {slackPipeline.suppression_reasons!.map((entry, index) => (
                <p key={`${entry.dismissed_action_id}-${index}`} className="text-muted-foreground">
                  {(entry.signal_type ?? "signal").replace(/_/g, " ")} · {entry.thread_key?.slice(-24) ?? "—"} ·{" "}
                  Suppressed because matching PM action was dismissed
                  {entry.title ? `: "${entry.title}"` : ""}
                  {entry.dismissed_at
                    ? ` (${formatDistanceToNow(new Date(entry.dismissed_at), { addSuffix: true })})`
                    : ""}
                </p>
              ))}
            </div>
          )}
          {slackPipeline.reasons.length > 0 && (
            <p className="text-muted-foreground">Reasons: {formatJobReasons(slackPipeline.reasons)}</p>
          )}
        </div>
      )}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading Slack diagnostics…</p>
      ) : isError ? (
        <p className="text-xs text-destructive">{(error as Error).message}</p>
      ) : !data ? null : (
        <>
          {data.hints?.length > 0 && (
            <div className="space-y-1 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-200">
              {data.hints.map((hint) => (
                <p key={hint}>{hint}</p>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {[
              ["Slack events", data.slackEventsCount],
              ["Meaningful events", data.meaningfulSlackEventsCount],
              ["Signals", data.projectSignalsCount],
              ["Open threads", data.openSignalThreadsCount],
              ["Queued jobs", data.queuedOrRunningJobsCount],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded border border-border/60 bg-muted/10 p-2 text-xs">
                <p className="text-[10px] uppercase tracking-wider text-cool-slate">{label}</p>
                <p className="font-medium">{value}</p>
              </div>
            ))}
          </div>
          {data.recentSlackEvents.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {data.recentSlackEvents.length} recent Slack event(s) stored for this link.
            </p>
          )}
          {data.recentSignals.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Recent Slack signals</p>
              {data.recentSignals.slice(0, 5).map((signal: ProjectSignal) => (
                <div key={signal.id} className="rounded border border-border/60 bg-muted/10 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] h-5 capitalize">
                      {signal.signal_type.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] h-5 capitalize">
                      {signal.signal_status}
                    </Badge>
                  </div>
                  <p className="mt-1 font-medium">{signal.title}</p>
                  {signal.summary && <p className="text-muted-foreground line-clamp-2">{signal.summary}</p>}
                  {signal.metadata && typeof signal.metadata === "object" && !Array.isArray(signal.metadata) && (
                    <p className="text-[10px] text-muted-foreground font-mono mt-1">
                      {(signal.metadata as Record<string, unknown>).action_family
                        ? `family: ${String((signal.metadata as Record<string, unknown>).action_family)}`
                        : null}
                      {(signal.metadata as Record<string, unknown>).processing_reason
                        ? ` · ${String((signal.metadata as Record<string, unknown>).processing_reason)}`
                        : null}
                      {(signal.metadata as Record<string, unknown>).suppression_reason
                        ? ` · ${String((signal.metadata as Record<string, unknown>).suppression_reason)}`
                        : null}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.recentThreads.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Signal threads</p>
              {data.recentThreads.map((thread: ProjectSignalThread) => (
                <div key={thread.id} className="rounded border border-border/60 bg-muted/10 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] h-5 capitalize">
                      {thread.current_state}
                    </Badge>
                    {thread.primary_signal_type && (
                      <Badge variant="secondary" className="text-[10px] h-5 capitalize">
                        {thread.primary_signal_type.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground mt-1">{thread.thread_key}</p>
                  {thread.summary && <p className="text-muted-foreground line-clamp-2">{thread.summary}</p>}
                </div>
              ))}
            </div>
          )}
          {data.recentJobs.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">AI processing jobs</p>
              {data.recentJobs.map((job: AiProcessingJob) => (
                <div key={job.id} className="rounded border border-border/60 bg-muted/10 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] h-5 capitalize">
                      {job.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {job.error_message && <p className="text-destructive mt-1">{job.error_message}</p>}
                  {job.result && typeof job.result === "object" && !Array.isArray(job.result) && (
                    <>
                      <p className="text-muted-foreground mt-1">
                        {formatJobReasons(
                          Array.isArray((job.result as Record<string, unknown>).reasons)
                            ? ((job.result as Record<string, unknown>).reasons as string[])
                            : [],
                        )}
                      </p>
                      {Array.isArray((job.result as Record<string, unknown>).suppression_reasons) &&
                        ((job.result as Record<string, unknown>).suppression_reasons as SuppressionReasonEntry[])
                          .length > 0 && (
                          <div className="mt-1 space-y-1">
                            {(
                              (job.result as Record<string, unknown>).suppression_reasons as SuppressionReasonEntry[]
                            ).map((entry, index) => (
                              <p key={`${entry.dismissed_action_id}-${index}`} className="text-muted-foreground">
                                {(entry.signal_type ?? "signal").replace(/_/g, " ")} ·{" "}
                                {entry.thread_key?.slice(-24) ?? "—"} · Suppressed because matching PM action was
                                dismissed{entry.title ? `: "${entry.title}"` : ""}
                              </p>
                            ))}
                          </div>
                        )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {onCleanDuplicates && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={cleanDuplicatesBusy}
                onClick={onCleanDuplicates}
              >
                Clean duplicate PM actions
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function isResolvedAction(item: ProjectPmActionItem) {
  return (
    item.status === "done" ||
    item.status === "dismissed" ||
    item.resolution_source === "clickup_signal" ||
    item.resolution_source === "slack_signal" ||
    Boolean(item.auto_resolved_reason)
  );
}

function isOpenAction(item: ProjectPmActionItem) {
  if (item.status === "dismissed" || item.status === "done") return false;
  if (item.execution_status === "succeeded" || item.execution_status === "skipped") return false;
  return item.status === "open" || item.status === "in_progress";
}

function OpenActionItemRow({
  item,
  taskLinks,
  onDone,
  onDismiss,
  onExecuteOpen,
  onCreateClickupOpen,
  onCopy,
  onResolveBlocker,
  busy,
}: {
  item: ProjectPmActionItem;
  taskLinks: Array<{ clickup_task_id: string; clickup_task_name: string | null; clickup_task_url: string | null }>;
  onDone: (item: ProjectPmActionItem) => void;
  onDismiss: (item: ProjectPmActionItem) => void;
  onExecuteOpen: (item: ProjectPmActionItem) => void;
  onCreateClickupOpen: (item: ProjectPmActionItem) => void;
  onCopy: (item: ProjectPmActionItem) => void;
  onResolveBlocker: (item: ProjectPmActionItem) => void;
  busy: boolean;
}) {
  const closed = item.status === "done" || item.status === "dismissed";
  const actionType = item.action_type ?? "manual";
  const accessBlocker = isAccessBlocker(item);
  const primaryLabel = primaryActionLabel(actionType, item);
  const clickupSynced = pmActionClickupSynced(item);
  const showCreateInClickup = !closed && isPmActionClickupTaskCandidate(item);
  const executable =
    ["assign_clickup_tasks", "update_clickup_deadline", "add_clickup_comment", "create_clickup_task"].includes(
      actionType,
    ) && !showCreateInClickup;
  const canCreateFromAi =
    actionType !== "create_clickup_task" || (item.action_payload?.ai_proposed_task_ids?.length ?? 0) > 0;
  const clickupUrl = item.clickup_task_url ?? taskLinks.find((l) => l.clickup_task_id === item.clickup_task_id)?.clickup_task_url;
  const taskTitle =
    item.related_clickup_task_titles?.[0] ??
    (() => {
      const taskId = item.related_clickup_task_ids?.[0] ?? item.action_payload?.clickup_task_ids?.[0];
      const task = taskId ? taskLinks.find((link) => link.clickup_task_id === taskId) : undefined;
      return task?.clickup_task_name ?? null;
    })();

  return (
    <div className="rounded-xl border border-card-border bg-card p-3 space-y-2 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{item.title}</p>
          {item.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{item.description}</p>}
          <PmActionSourceContext item={item} />
          {item.last_signal_summary && !item.source_message && (
            <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">"{item.last_signal_summary}"</p>
          )}
        </div>
        <Badge variant={badgeVariant(item.priority)} className="capitalize text-[10px] h-5">
          {item.priority}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={item.category === "access_needed" ? "destructive" : "outline"} className="capitalize text-[10px] h-5">
          {categoryLabel(item.category)}
        </Badge>
        {(item.signal_count ?? 1) > 1 && (
          <Badge variant="secondary" className="text-[10px] h-5">
            {item.signal_count} signals
          </Badge>
        )}
        {isRepeatedBlockerAction(item) && (
          <Badge variant="outline" className="text-[10px] h-5">
            Repeated blocker
          </Badge>
        )}
        <Badge variant="outline" className="capitalize text-[10px] h-5">
          {(actionType ?? "manual").replace(/_/g, " ")}
        </Badge>
        <Badge variant={closed ? "secondary" : "outline"} className="capitalize text-[10px] h-5">
          {item.status.replace(/_/g, " ")}
        </Badge>
        {item.execution_status && item.execution_status !== "not_started" && (
          <Badge variant={item.execution_status === "failed" ? "destructive" : "secondary"} className="capitalize text-[10px] h-5">
            {item.execution_status.replace(/_/g, " ")}
          </Badge>
        )}
        {clickupSynced && (
          <Badge variant="secondary" className="text-[10px] h-5">
            Created in ClickUp
          </Badge>
        )}
      </div>
      {!closed && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(item.signal_count ?? 1) > 1 && item.latest_signal_at && (
            <span>Latest: {formatDistanceToNow(new Date(item.latest_signal_at), { addSuffix: true })}</span>
          )}
          {taskTitle && <span className="truncate max-w-full">Task: {taskTitle}</span>}
        </div>
      )}
      {item.execution_error && (
        <p className="text-xs text-destructive">{item.execution_error}</p>
      )}
      {!closed && (
        <div className="flex flex-wrap justify-end gap-1">
          {accessBlocker && (
            <>
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => onResolveBlocker(item)}>
                <Check className="h-3 w-3" /> Resolve blocker
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => onCopy(item)}>
                <ClipboardCopy className="h-3 w-3" /> Copy access request
              </Button>
            </>
          )}
          {!accessBlocker && actionType === "ask_client_question" && (
            <Button size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => onCopy(item)}>
              <ClipboardCopy className="h-3 w-3" /> Copy question
            </Button>
          )}
          {!accessBlocker && showCreateInClickup && (
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={busy}
              onClick={() => onCreateClickupOpen(item)}
            >
              Create in ClickUp
            </Button>
          )}
          {!accessBlocker && clickupSynced && clickupUrl && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" asChild>
              <a href={clickupUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3 w-3" /> Open in ClickUp
              </a>
            </Button>
          )}
          {!accessBlocker && executable && primaryLabel && (
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={busy || !canCreateFromAi}
              onClick={() => onExecuteOpen(item)}
            >
              {actionType === "assign_clickup_tasks" && <UserPlus className="h-3 w-3" />}
              {actionType === "add_clickup_comment" && <MessageSquare className="h-3 w-3" />}
              {primaryLabel}
            </Button>
          )}
          {shouldShowMarkDone(item, executable, accessBlocker) && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => onDone(item)}>
              <Check className="h-3 w-3" /> Mark done
            </Button>
          )}
          <DismissButton disabled={busy} onClick={() => onDismiss(item)} />
        </div>
      )}
    </div>
  );
}

function ClosedActionItemRow({
  item,
  variant,
  onReopen,
  busy,
}: {
  item: ProjectPmActionItem;
  variant: "resolved" | "dismissed";
  onReopen?: (item: ProjectPmActionItem) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const completedAt = item.dismissed_at ?? item.completed_at ?? item.executed_at ?? item.updated_at;
  const autoResolved = item.resolution_source === "clickup_signal" || Boolean(item.auto_resolved_reason);
  const suppressedCount = item.suppressed_signal_count ?? 0;
  const clickupUrl = item.clickup_task_url;

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-2.5 space-y-1.5 opacity-70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground leading-snug">{item.title}</p>
          {expanded && (
            <div className="text-xs text-muted-foreground mt-1 space-y-1">
              {item.description && <p className="whitespace-pre-wrap">{item.description}</p>}
              {autoResolved && item.auto_resolved_reason && (
                <p className="italic">{item.auto_resolved_reason}</p>
              )}
            </div>
          )}
        </div>
        <Badge
          variant={variant === "resolved" ? "secondary" : "outline"}
          className="capitalize text-[10px] h-5 shrink-0"
        >
          {autoResolved ? "Resolved automatically" : variant === "resolved" ? "Resolved" : "Dismissed"}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="capitalize">{categoryLabel(item.category)}</span>
        {variant === "dismissed" && item.dismissed_at && (
          <span>· Dismissed {formatDistanceToNow(new Date(item.dismissed_at), { addSuffix: true })}</span>
        )}
        {variant === "dismissed" && suppressedCount > 0 && (
          <span>· Suppressed {suppressedCount} repeated signal{suppressedCount === 1 ? "" : "s"}</span>
        )}
        {variant === "dismissed" && item.latest_suppressed_at && (
          <span>· Latest {formatDistanceToNow(new Date(item.latest_suppressed_at), { addSuffix: true })}</span>
        )}
        {variant === "resolved" && completedAt && (
          <span>· {formatDistanceToNow(new Date(completedAt), { addSuffix: true })}</span>
        )}
        {pmActionClickupSynced(item) && (
          <Badge variant="secondary" className="text-[10px] h-5">Created in ClickUp</Badge>
        )}
      </div>
      <div className="flex justify-end gap-1">
        {clickupUrl && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" asChild>
            <a href={clickupUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3" /> Open in ClickUp
            </a>
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide details" : "View details"}
        </Button>
        {onReopen && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onReopen(item)}>
            Reopen
          </Button>
        )}
      </div>
    </div>
  );
}

function ResolveBlockerDialog({
  item,
  open,
  onOpenChange,
  busy,
  onConfirm,
  clickupConnected,
  onConnectClickup,
  connectBusy,
}: {
  item: ProjectPmActionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onConfirm: (item: ProjectPmActionItem, resolutionNote: string) => void;
  clickupConnected: boolean;
  onConnectClickup: () => void;
  connectBusy: boolean;
}) {
  const [note, setNote] = useState("");

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, item?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve access blocker</DialogTitle>
          <DialogDescription>
            {clickupConnected
              ? "Mark this blocker resolved after you have handled the access request. ClickUp updates will be sent as your connected ClickUp account."
              : "Connect ClickUp first to post comments or update task status. You can still mark the blocker resolved in OXUS after handling access externally."}
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{item.title}</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional resolution note (e.g. invited in Bubble admin)"
              rows={3}
            />
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {!clickupConnected && (
            <Button variant="outline" onClick={onConnectClickup} disabled={connectBusy}>
              Connect ClickUp
            </Button>
          )}
          <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !item}
            onClick={() => item && onConfirm(item, note.trim())}
          >
            Mark blocker resolved
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useProjectControlCenterAnalyze(projectId: string) {
  const { toast } = useToast();
  const { data: clickupLink = null } = useProjectClickupLink(projectId);
  const generateReport = useGenerateProjectStatusReport();
  const { handleError } = useClickupOAuthHandler();

  const needsReview =
    clickupLink?.metadata &&
    typeof clickupLink.metadata === "object" &&
    !Array.isArray(clickupLink.metadata) &&
    (clickupLink.metadata as Record<string, unknown>).needs_ai_review === true;

  const analyze = async () => {
    try {
      const result = await generateReport.mutateAsync({
        project_id: projectId,
        report_type: needsReview ? "after_clickup_sync" : "manual",
      });
      const syncNote =
        result.clickup_sync && !result.clickup_sync.skipped && result.clickup_sync.comments_imported_count > 0
          ? ` Synced ${result.clickup_sync.comments_imported_count} ClickUp comment(s) first.`
          : "";
      const pipeline = result.slack_pipeline;
      const pipelineNote = pipeline
        ? pipeline.actions_created_count > 0
          ? ` ${pipeline.actions_created_count} Slack-derived PM action(s).`
          : pipeline.processed_count === 0 && pipeline.reasons.length > 0
            ? ` Slack: ${formatJobReasons(pipeline.reasons)}.`
            : ""
        : "";
      toast({
        title: "Project report generated",
        description: `${result.action_items.length} PM action item(s) updated.${syncNote}${pipelineNote}`,
      });
    } catch (e) {
      if (!handleError(e, "Analysis failed")) {
        toast({ title: "Analysis failed", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  return { analyze, isPending: generateReport.isPending, needsReview, isError: generateReport.isError, error: generateReport.error };
}

export function ProjectControlCenterAnalyzeButton({
  projectId,
  size = "sm",
}: {
  projectId: string;
  size?: "sm" | "default";
}) {
  const { analyze, isPending } = useProjectControlCenterAnalyze(projectId);

  return (
    <Button size={size} className="gap-1" onClick={() => void analyze()} disabled={isPending}>
      <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
      {isPending ? "Syncing & analyzing..." : "Analyze latest updates"}
    </Button>
  );
}

export function ProjectControlCenterPanel({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const { data: latestReport = null, isLoading: reportLoading } = useLatestProjectAiStatusReport(projectId);
  const { data: actionItems = [] } = useProjectPmActionItems(projectId);
  const { data: clickupLink = null } = useProjectClickupLink(projectId);
  const { data: taskLinks = [] } = useClickupTaskLinks(projectId);
  const { analyze, isPending: analyzePending, needsReview, isError: analyzeIsError, error: analyzeError } =
    useProjectControlCenterAnalyze(projectId);
  const updateAction = useUpdateProjectPmActionItemStatus();
  const dedupeActions = useDedupePmActionItems();
  const executeAction = useExecutePmAction();
  const createClickupFromPmAction = useCreateClickupTaskFromPmAction();
  const { data: clickupStatus, refetch: refetchClickup } = useClickupMyConnection();
  const startClickupOAuth = useStartClickupOAuth();
  const { handleError, startConnect } = useClickupOAuthHandler();
  const [executeItem, setExecuteItem] = useState<ProjectPmActionItem | null>(null);
  const [createClickupItem, setCreateClickupItem] = useState<ProjectPmActionItem | null>(null);
  const [pendingClickupPmActionId, setPendingClickupPmActionId] = useState<string | null>(null);
  const [resolveItem, setResolveItem] = useState<ProjectPmActionItem | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionListFilter>("open");
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const { openActions, resolvedActions } = useMemo(() => {
    const open: ProjectPmActionItem[] = [];
    const resolved: ProjectPmActionItem[] = [];
    for (const item of actionItems) {
      if (isOpenAction(item)) open.push(item);
      else resolved.push(item);
    }
    open.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    resolved.sort(
      (a, b) =>
        new Date(b.completed_at ?? b.executed_at ?? b.updated_at).getTime() -
        new Date(a.completed_at ?? a.executed_at ?? a.updated_at).getTime(),
    );
    return { openActions: open, resolvedActions: resolved };
  }, [actionItems]);

  const openActionCount = openActions.length;
  const resolvedActionCount = resolvedActions.length;
  const visibleActions = actionFilter === "open" ? openActions : resolvedActions;

  const diagnosticGroups = useMemo(() => {
    const raw = latestReport?.raw_response;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const groups = (raw as Record<string, unknown>).conversation_groups;
    if (!Array.isArray(groups)) return [];
    return (groups as StoredConversationGroup[])
      .map(normalizeDiagnosticGroup)
      .filter((group) => {
        if (!group.hasContent) return false;
        if (group.netState === "open_issue" && !group.reason && !group.latestComment) return false;
        return true;
      });
  }, [latestReport?.raw_response]);

  const slackPipelineFromReport = useMemo(() => {
    const raw = latestReport?.raw_response;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const pipeline = (raw as Record<string, unknown>).slack_pipeline;
    if (!pipeline || typeof pipeline !== "object" || Array.isArray(pipeline)) return null;
    return pipeline as ProcessAiJobsResult;
  }, [latestReport?.raw_response]);

  const busy =
    updateAction.isPending ||
    executeAction.isPending ||
    createClickupFromPmAction.isPending ||
    analyzePending ||
    dedupeActions.isPending;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clickupStatusParam = params.get("clickup");

    if (clickupStatusParam === "error") {
      const message = params.get("message");
      stripClickupConnectedSearchParam();
      clearClickupOAuthReturnIntent();
      if (message) {
        toast({
          title: "ClickUp connection failed",
          description: decodeURIComponent(message),
          variant: "destructive",
        });
      }
      return;
    }

    if (clickupStatusParam !== "connected") return;

    stripClickupConnectedSearchParam();
    void refetchClickup();

    const intent = consumeClickupOAuthReturnIntent(projectId);
    if (intent?.kind === "pm_action") {
      toast({ title: "ClickUp connected", description: "Opening task creation…" });
      setPendingClickupPmActionId(intent.itemId);
    } else if (intent) {
      saveClickupOAuthReturnIntent(intent);
    }
  }, [projectId, refetchClickup, toast]);

  useEffect(() => {
    if (!pendingClickupPmActionId || clickupStatus?.connected !== true) return;
    const item = actionItems.find((row) => row.id === pendingClickupPmActionId);
    if (item) {
      setCreateClickupItem(item);
      setPendingClickupPmActionId(null);
    }
  }, [pendingClickupPmActionId, clickupStatus?.connected, actionItems]);

  const openCreateClickup = async (item: ProjectPmActionItem) => {
    if (clickupStatus?.connected !== true) {
      saveClickupOAuthReturnIntent({ projectId, kind: "pm_action", itemId: item.id });
      try {
        await startConnect(() =>
          startClickupOAuth.mutateAsync({ redirect_after: projectClickupOAuthReturnPath(projectId) }),
        );
      } catch (e) {
        clearClickupOAuthReturnIntent();
        handleError(e, "Could not start ClickUp connection");
      }
      return;
    }
    setCreateClickupItem(item);
  };

  const cleanDuplicateActions = async () => {
    try {
      const result = await dedupeActions.mutateAsync({ project_id: projectId });
      toast({
        title: result.items_merged > 0 ? "Duplicates cleaned" : "No duplicates found",
        description:
          result.items_merged > 0
            ? `Merged ${result.items_merged} duplicate action(s).`
            : result.duplicates_found > 0
              ? `${result.duplicates_found} duplicate(s) detected (dry run only).`
              : "All PM actions look unique.",
      });
    } catch (e) {
      toast({ title: "Could not clean duplicates", description: (e as Error).message, variant: "destructive" });
    }
  };

  const connectClickup = async () => {
    try {
      await startConnect(() => startClickupOAuth.mutateAsync({ redirect_after: "/settings?connect=clickup" }));
    } catch (e) {
      handleError(e, "Could not start ClickUp connection");
    }
  };

  const updateStatus = async (item: ProjectPmActionItem, status: ProjectPmActionItem["status"]) => {
    try {
      await updateAction.mutateAsync({ id: item.id, project_id: projectId, status });
    } catch (e) {
      toast({ title: "Could not update action", description: (e as Error).message, variant: "destructive" });
    }
  };

  const copyActionText = async (item: ProjectPmActionItem) => {
    const text =
      item.action_type === "request_access"
        ? buildAccessRequestCopy(item, taskLinks)
        : item.action_payload?.question_text ?? item.description ?? item.title;
    try {
      await copyText(text);
      toast({ title: "Copied to clipboard", description: "Paste into email, Slack, or your client channel." });
    } catch (e) {
      toast({ title: "Copy failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const resolveBlocker = async (item: ProjectPmActionItem, resolutionNote: string) => {
    try {
      await executeAction.mutateAsync({
        action_item_id: item.id,
        project_id: projectId,
        execution_payload: {
          resolve_blocker: true,
          resolution_note: resolutionNote || undefined,
        },
      });
      setResolveItem(null);
      toast({ title: "Blocker resolved", description: "Recorded as resolved in OXUS Cloud." });
    } catch (e) {
      if (!handleError(e, "Could not resolve blocker")) {
        toast({ title: "Could not resolve blocker", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const runExecute = async (input: Parameters<typeof executeAction.mutateAsync>[0]) => {
    try {
      await executeAction.mutateAsync(input);
      setExecuteItem(null);
      toast({ title: "Action executed", description: "ClickUp was updated where applicable." });
    } catch (e) {
      if (!handleError(e, "Action failed")) {
        toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const createClickupTask = async (input: {
    title: string;
    description?: string;
    priority: ProjectPmActionItem["priority"];
    status?: string;
    assignee_ids: string[];
    due_date?: string;
    time_estimate_minutes?: number;
  }) => {
    if (!createClickupItem) return;
    try {
      const result = await createClickupFromPmAction.mutateAsync({
        pm_action_item_id: createClickupItem.id,
        project_id: projectId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        status: input.status,
        assignee_ids: input.assignee_ids,
        due_date: input.due_date,
        time_estimate_minutes: input.time_estimate_minutes,
      });
      setCreateClickupItem(null);
      toast({
        title: result.already_created ? "Already in ClickUp" : "Task created in ClickUp",
        description: result.warnings?.length
          ? result.warnings.join(" ")
          : result.already_created
          ? "This PM action was already converted to a ClickUp task."
          : "The PM action was marked done and linked to the new task.",
        variant: result.warnings?.length ? "destructive" : undefined,
      });
    } catch (e) {
      if (!handleError(e, "Could not create ClickUp task")) {
        toast({ title: "Could not create ClickUp task", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Project Control Center</h3>
              {needsReview && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <ShieldAlert className="h-3 w-3" /> New ClickUp updates need analysis
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Syncs latest ClickUp comments and Slack signals, then analyzes activity and project memory
            </p>
          </div>
          <ProjectControlCenterAnalyzeButton projectId={projectId} />
        </div>
      )}

      {!embedded && !clickupLink && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No ClickUp link for this project</AlertTitle>
          <AlertDescription className="text-xs">
            Create a ClickUp space for this project first. Analysis can still run, but no ClickUp comments will be synced.
          </AlertDescription>
        </Alert>
      )}

      {analyzeIsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">{analyzeError?.message}</AlertDescription>
        </Alert>
      )}

      {!embedded && reportLoading ? (
        <p className="text-sm text-muted-foreground">Loading control center...</p>
      ) : !embedded && !latestReport ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center">
          <BrainCircuit className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No AI status report yet.</p>
          <p className="text-sm text-muted-foreground">Analyze the latest ClickUp updates to generate PM actions.</p>
        </div>
      ) : latestReport ? (
        <Accordion type="single" collapsible defaultValue={embedded ? undefined : "report"} className="rounded-lg border border-border">
          <AccordionItem value="report" className="border-none px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              <span className="flex items-center gap-2">
                Latest AI status report
                <Badge variant="outline" className="h-5 text-[10px]">
                  {formatDistanceToNow(new Date(latestReport.created_at), { addSuffix: true })}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              <p className="text-[10px] uppercase tracking-wider text-cool-slate">Report</p>
              <p className="text-xs font-medium">
                {formatDistanceToNow(new Date(latestReport.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              <p className="text-[10px] uppercase tracking-wider text-cool-slate">Confidence</p>
              <p className="text-xs font-medium">{confidenceLabel(latestReport.confidence)}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              <p className="text-[10px] uppercase tracking-wider text-cool-slate">Health</p>
              <Badge variant={badgeVariant(latestReport.health_recommendation)} className="capitalize text-[10px] h-5 mt-1">
                {latestReport.health_recommendation ?? "No change"}
              </Badge>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              <p className="text-[10px] uppercase tracking-wider text-cool-slate">Risk</p>
              <Badge variant={badgeVariant(latestReport.risk_recommendation)} className="capitalize text-[10px] h-5 mt-1">
                {latestReport.risk_recommendation ?? "No change"}
              </Badge>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              <p className="text-[10px] uppercase tracking-wider text-cool-slate">Blockers</p>
              <p className="text-xs font-medium">{latestReport.blockers.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              <p className="text-[10px] uppercase tracking-wider text-cool-slate">PM Actions</p>
              <p className="text-xs font-medium">{openActionCount}</p>
            </div>
          </div>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Latest Report</h4>
            {latestReport.summary && (
              <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground leading-relaxed">
                {latestReport.summary}
              </p>
            )}
            <ReportSections report={latestReport} />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setShowDiagnostics((value) => !value)}
              >
                {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
              </Button>
            </div>
            {showDiagnostics && (
              <section className="space-y-3 rounded-lg border border-dashed border-border/80 bg-muted/10 p-3">
                <h4 className="section-label">
                  Analysis Diagnostics
                </h4>
                <SlackDiagnosticsSection
                  projectId={projectId}
                  slackPipeline={slackPipelineFromReport}
                  onCleanDuplicates={cleanDuplicateActions}
                  cleanDuplicatesBusy={dedupeActions.isPending}
                />
                {diagnosticGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ClickUp conversation diagnostics for this report.</p>
                ) : (
                  <div className="space-y-2">
                    <h5 className="text-[11px] font-semibold uppercase tracking-wider text-cool-slate">
                      ClickUp Conversations
                    </h5>
                    {diagnosticGroups.map((group) => (
                      <DiagnosticConversationRow key={group.groupId} group={group} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">PM Action Items</h4>
          <button
            type="button"
            onClick={() => setActionFilter("open")}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={actionFilter === "open"}
          >
            <Badge
              variant={actionFilter === "open" ? "default" : "outline"}
              className={cn("cursor-pointer text-[10px]", actionFilter === "open" && "shadow-sm")}
            >
              {openActionCount} open
            </Badge>
          </button>
          {resolvedActionCount > 0 && (
            <button
              type="button"
              onClick={() => setActionFilter("resolved")}
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={actionFilter === "resolved"}
            >
              <Badge
                variant={actionFilter === "resolved" ? "secondary" : "outline"}
                className={cn("cursor-pointer text-[10px]", actionFilter === "resolved" && "shadow-sm")}
              >
                {resolvedActionCount} resolved
              </Badge>
            </button>
          )}
        </div>

        {actionItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PM action items yet.</p>
        ) : visibleActions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {actionFilter === "open" ? "No open actions — you're caught up." : "No resolved actions yet."}
          </p>
        ) : (
          <div className="space-y-2">
            {actionFilter === "open"
              ? visibleActions.map((item) => (
                  <OpenActionItemRow
                    key={item.id}
                    item={item}
                    taskLinks={taskLinks}
                    busy={busy}
                    onDone={(action) => updateStatus(action, "done")}
                    onDismiss={(action) => updateStatus(action, "dismissed")}
                    onExecuteOpen={setExecuteItem}
                    onCreateClickupOpen={openCreateClickup}
                    onCopy={copyActionText}
                    onResolveBlocker={setResolveItem}
                  />
                ))
              : visibleActions.map((item) => (
                  <ClosedActionItemRow
                    key={item.id}
                    item={item}
                    variant={item.status === "dismissed" ? "dismissed" : "resolved"}
                    busy={busy}
                    onReopen={
                      item.status === "dismissed" ||
                      (item.resolution_source !== "clickup_signal" && item.resolution_source !== "slack_signal")
                        ? (action) => updateStatus(action, "open")
                        : undefined
                    }
                  />
                ))}
          </div>
        )}
      </section>

      <ResolveBlockerDialog
        item={resolveItem}
        open={!!resolveItem}
        onOpenChange={(open) => !open && setResolveItem(null)}
        busy={executeAction.isPending}
        onConfirm={resolveBlocker}
        clickupConnected={clickupStatus?.connected === true}
        onConnectClickup={connectClickup}
        connectBusy={startClickupOAuth.isPending}
      />

      <ExecutePmActionDialog
        open={!!executeItem}
        onOpenChange={(open) => !open && setExecuteItem(null)}
        item={executeItem}
        projectId={projectId}
        teamId={clickupLink?.clickup_team_id}
        busy={executeAction.isPending}
        onExecute={runExecute}
      />

      <CreateClickupTaskFromPmActionDialog
        open={!!createClickupItem}
        onOpenChange={(open) => !open && setCreateClickupItem(null)}
        item={createClickupItem}
        projectId={projectId}
        teamId={clickupLink?.clickup_team_id}
        busy={createClickupFromPmAction.isPending}
        onConfirm={createClickupTask}
      />
    </div>
  );
}
