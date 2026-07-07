import React, { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import {
  AlertCircle,
  AlertTriangle,
  ClipboardCopy,
  ExternalLink,
  LayoutDashboard,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";
import {
  useGeneratePmDailyPlan,
  useLatestPmDailyPlan,
  usePmOpenActionItems,
  usePmProjectsNeedingAttention,
  usePmRecentClickupActivity,
  usePmRecentSlackSignals,
  usePmStaleClickupTasks,
  useUpdateProjectPmActionItemStatus,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import type { PmOpenActionItem, PmProjectAttention } from "@/lib/types";
import {
  copyTextForPmAction,
  isClientQuestionAction,
  pmActionCategoryLabel,
} from "@/lib/pmActions";
import { PmActionSourceContext } from "@/components/pm/PmActionSourceContext";
import { cn } from "@/lib/utils";

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[10px] uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: PmOpenActionItem["priority"] }) {
  const variant =
    priority === "urgent" ? "destructive" : priority === "high" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="capitalize text-[10px] h-5">
      {priority}
    </Badge>
  );
}

function PriorityActionRow({
  item,
  busy,
  onOpen,
  onCopy,
  onDismiss,
}: {
  item: PmOpenActionItem;
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  const taskTitle = item.related_clickup_task_titles?.[0] ?? null;
  const canCopy = isClientQuestionAction(item) || item.category === "access_needed";

  return (
    <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-primary truncate">{item.project_name}</p>
          <p className="text-sm font-medium leading-snug">{item.title}</p>
        </div>
        <div className="flex flex-wrap gap-1 shrink-0">
          <Badge variant="outline" className="capitalize text-[10px] h-5">
            {pmActionCategoryLabel(item.category)}
          </Badge>
          <PriorityBadge priority={item.priority} />
        </div>
      </div>
      {item.last_signal_summary && !item.source_message && (
        <p className="text-xs text-muted-foreground line-clamp-2">{item.last_signal_summary}</p>
      )}
      <PmActionSourceContext item={item} />
      {taskTitle && <p className="text-[11px] text-muted-foreground">Task: {taskTitle}</p>}
      <div className="flex flex-wrap gap-1 pt-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpen}>
          Open Project
        </Button>
        {canCopy && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={busy} onClick={onCopy}>
            <ClipboardCopy className="h-3 w-3" />
            Copy
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function AttentionRow({
  project,
  onOpen,
}: {
  project: PmProjectAttention;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-border/70 bg-card p-3 text-left transition-colors hover:bg-muted/30"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{project.project_name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ProjectHealthBadge health={project.health} />
            <Badge variant="outline" className="capitalize text-[10px] h-5">
              {project.risk} risk
            </Badge>
            {project.needs_ai_review && (
              <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                <Sparkles className="h-3 w-3" />
                Needs analysis
              </Badge>
            )}
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground shrink-0">
          {project.urgent_action_count > 0 && (
            <p>{project.urgent_action_count} urgent</p>
          )}
          {project.high_action_count > 0 && <p>{project.high_action_count} high</p>}
          <p>{project.open_action_count} open</p>
        </div>
      </div>
      {project.latest_clickup_event_at && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Latest ClickUp activity{" "}
          {formatDistanceToNow(new Date(project.latest_clickup_event_at), { addSuffix: true })}
        </p>
      )}
    </button>
  );
}

export function PmCommandCenterSection() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: openActions = [], isLoading: actionsLoading } = usePmOpenActionItems();
  const { data: attentionProjects = [], isLoading: attentionLoading } = usePmProjectsNeedingAttention();
  const { data: recentActivity = [] } = usePmRecentClickupActivity();
  const { data: slackSignals = [] } = usePmRecentSlackSignals();
  const { data: staleTasks = [] } = usePmStaleClickupTasks();
  const { data: dailyPlan = null, isLoading: planLoading } = useLatestPmDailyPlan();
  const generatePlan = useGeneratePmDailyPlan();
  const updateAction = useUpdateProjectPmActionItemStatus();

  const topPriorities = useMemo(() => openActions.slice(0, 5), [openActions]);

  const metrics = useMemo(() => {
    const urgentBlockers = openActions.filter(
      (a) =>
        (a.blocker_type || a.category === "access_needed") &&
        (a.priority === "urgent" || a.priority === "high"),
    ).length;
    const clientQuestions = openActions.filter(isClientQuestionAction).length;
    const needsAnalysis = attentionProjects.filter((p) => p.needs_ai_review).length;
    return {
      needingAttention: attentionProjects.length,
      urgentBlockers,
      clientQuestions,
      needsAnalysis,
      staleTasks: staleTasks.length,
    };
  }, [openActions, attentionProjects, staleTasks]);

  const busy = updateAction.isPending || generatePlan.isPending;

  const dismissAction = async (item: PmOpenActionItem) => {
    try {
      await updateAction.mutateAsync({ id: item.id, project_id: item.project_id, status: "dismissed" });
      toast({ title: "Action dismissed" });
    } catch (e) {
      toast({ title: "Could not dismiss", description: (e as Error).message, variant: "destructive" });
    }
  };

  const copyAction = async (item: PmOpenActionItem) => {
    try {
      await navigator.clipboard.writeText(copyTextForPmAction(item));
      toast({ title: "Copied to clipboard" });
    } catch (e) {
      toast({ title: "Copy failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const generateDailyPlan = async () => {
    try {
      await generatePlan.mutateAsync({});
      toast({ title: "Today's plan generated" });
    } catch (e) {
      toast({ title: "Plan generation failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-4 md:p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">PM Command Center</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Projects, blockers, and actions that need attention
          </p>
        </div>
        <Button size="sm" className="gap-1.5 h-8" onClick={generateDailyPlan} disabled={generatePlan.isPending}>
          <Sparkles className={cn("h-3.5 w-3.5", generatePlan.isPending && "animate-pulse")} />
          {generatePlan.isPending ? "Generating…" : "Generate today's plan"}
        </Button>
      </div>

      {generatePlan.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Plan generation failed</AlertTitle>
          <AlertDescription className="text-xs">{generatePlan.error.message}</AlertDescription>
        </Alert>
      )}

      {!planLoading && dailyPlan && (
        <Card className="border-primary/20 bg-primary/5 shadow-none">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="section-label">
                Today's plan
              </p>
              <span className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(dailyPlan.created_at), { addSuffix: true })}
              </span>
            </div>
            {dailyPlan.summary && <p className="text-sm leading-relaxed">{dailyPlan.summary}</p>}
            {dailyPlan.top_priorities.length > 0 && (
              <ul className="space-y-1">
                {dailyPlan.top_priorities.slice(0, 5).map((item, i) => (
                  <li key={`${i}-${item.slice(0, 20)}`} className="text-xs text-muted-foreground">
                    • {item}
                  </li>
                ))}
              </ul>
            )}
            {dailyPlan.suggested_order.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Suggested order: {dailyPlan.suggested_order.slice(0, 4).join(" → ")}
              </p>
            )}
            {dailyPlan.project_focus.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {dailyPlan.project_focus.slice(0, 4).map((focus) => (
                  <Badge key={focus.project_id} variant="outline" className="text-[10px] font-normal">
                    {focus.project_name}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <MetricCard
          label="Needing attention"
          value={metrics.needingAttention}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Urgent blockers"
          value={metrics.urgentBlockers}
          icon={<ShieldAlert className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Client questions"
          value={metrics.clientQuestions}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Needs analysis"
          value={metrics.needsAnalysis}
          icon={<RefreshCw className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Stale tasks"
          value={metrics.staleTasks}
          icon={<AlertCircle className="h-3.5 w-3.5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Today's Priority</h3>
          {actionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading actions…</p>
          ) : topPriorities.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4 text-center">
              No open PM actions — you're caught up.
            </p>
          ) : (
            <div className="space-y-2">
              {topPriorities.map((item) => (
                <PriorityActionRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  onOpen={() => navigate(`/projects/${item.project_id}`)}
                  onCopy={() => copyAction(item)}
                  onDismiss={() => dismissAction(item)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Projects Needing Attention</h3>
          {attentionLoading ? (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          ) : attentionProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4 text-center">
              All projects look stable right now.
            </p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {attentionProjects.slice(0, 12).map((project) => (
                <AttentionRow
                  key={project.project_id}
                  project={project}
                  onOpen={() => navigate(`/projects/${project.project_id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Accordion type="multiple" className="rounded-lg border border-border">
        <AccordionItem value="signals" className="px-3">
          <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
            Recent ClickUp Signals ({recentActivity.length})
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pb-3">
            {recentActivity.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recent ClickUp activity.</p>
            ) : (
              recentActivity.slice(0, 12).map((event) => (
                <div key={event.id} className="rounded-md border border-border/60 bg-muted/10 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{event.project_name}</span>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="mt-0.5 font-medium">{event.event_title}</p>
                  {event.event_summary && (
                    <p className="text-muted-foreground line-clamp-2">{event.event_summary}</p>
                  )}
                  {event.task_name && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">Task: {event.task_name}</p>
                  )}
                </div>
              ))
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="slack" className="px-3">
          <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
            Recent Slack Signals ({slackSignals.length})
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pb-3">
            {slackSignals.length === 0 ? (
              <p className="text-xs text-muted-foreground">No meaningful Slack signals yet.</p>
            ) : (
              slackSignals.slice(0, 10).map((event) => (
                <div key={event.id} className="rounded-md border border-border/60 bg-muted/10 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{event.project_name}</span>
                    {event.channel_name && <span>#{event.channel_name}</span>}
                    <Badge variant="outline" className="text-[10px] h-5 capitalize">
                      {(event.signal_type ?? "unknown").replace(/_/g, " ")}
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground line-clamp-2">
                    {event.message_preview ?? event.message_text ?? "—"}
                  </p>
                </div>
              ))
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="stale" className="px-3">
          <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
            Stale / Quiet ClickUp Tasks ({staleTasks.length})
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pb-3">
            {staleTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No stale or overdue tasks detected.</p>
            ) : (
              staleTasks.map((task) => (
                <div
                  key={`${task.project_id}-${task.clickup_task_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/10 p-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{task.task_name ?? task.clickup_task_id}</p>
                    <p className="text-muted-foreground">
                      {task.project_name}
                      {task.status ? ` · ${task.status}` : ""}
                      {task.due_date ? ` · due ${task.due_date}` : ""}
                      {task.days_quiet > 0 ? ` · quiet ${task.days_quiet}d` : ""}
                    </p>
                  </div>
                  {task.task_url && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs shrink-0" asChild>
                      <a href={task.task_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                    </Button>
                  )}
                </div>
              ))
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
