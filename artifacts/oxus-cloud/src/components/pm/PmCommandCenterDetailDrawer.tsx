import React from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  AlertTriangle,
  ClipboardCopy,
  ExternalLink,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityDrawer } from "@/components/EntityDrawer";
import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PmActionSourceContext } from "@/components/pm/PmActionSourceContext";
import type {
  PmDailyPlan,
  PmOpenActionItem,
  PmProjectAttention,
  PmRecentClickupActivity,
  PmStaleClickupTask,
  ProjectSlackEvent,
} from "@/lib/types";
import { isClientQuestionAction, pmActionCategoryLabel } from "@/lib/pmActions";
import { cn } from "@/lib/utils";

export type PmCommandCenterDrawerTab = "actions" | "attention" | "signals" | "plan";

function PriorityBadge({ priority }: { priority: PmOpenActionItem["priority"] }) {
  const variant =
    priority === "urgent" ? "destructive" : priority === "high" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="capitalize text-[10px] h-5">
      {priority}
    </Badge>
  );
}

export function CompactPriorityActionRow({
  item,
  busy,
  onOpen,
  onCopy,
  onDismiss,
  showSource = false,
}: {
  item: PmOpenActionItem;
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onDismiss: () => void;
  showSource?: boolean;
}) {
  const canCopy = isClientQuestionAction(item) || item.category === "access_needed";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-b border-border/40 last:border-0">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium leading-snug truncate">{item.title}</p>
          <PriorityBadge priority={item.priority} />
          <Badge variant="outline" className="capitalize text-[10px] h-5">
            {pmActionCategoryLabel(item.category)}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{item.project_name}</p>
        {showSource && <PmActionSourceContext item={item} />}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpen}>
          Open
        </Button>
        {canCopy && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            disabled={busy}
            onClick={onCopy}
            aria-label="Copy action text"
          >
            <ClipboardCopy className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={busy}
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function CompactAttentionRow({
  project,
  onOpen,
}: {
  project: PmProjectAttention;
  onOpen: () => void;
}) {
  const primaryReason = project.needs_ai_review
    ? "Needs analysis"
    : project.urgent_action_count > 0
      ? `${project.urgent_action_count} urgent`
      : project.high_action_count > 0
        ? `${project.high_action_count} high priority`
        : project.open_action_count > 0
          ? `${project.open_action_count} open actions`
          : "Needs attention";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 py-1.5 text-left border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors rounded-sm -mx-1 px-1"
    >
      <span className="text-sm font-medium truncate shrink-0 max-w-[40%]">{project.project_name}</span>
      <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0">
        {primaryReason}
        {project.latest_clickup_event_at && (
          <>
            {" · "}
            Last ClickUp{" "}
            {formatDistanceToNow(new Date(project.latest_clickup_event_at), { addSuffix: true })}
          </>
        )}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
        {project.open_action_count} open
      </span>
    </button>
  );
}

function FullAttentionRow({
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
      className="w-full rounded-md border border-border/60 bg-muted/10 p-3 text-left transition-colors hover:bg-muted/30"
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
          {project.urgent_action_count > 0 && <p>{project.urgent_action_count} urgent</p>}
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

function SignalDiagnosticsContent({
  recentActivity,
  slackSignals,
  staleTasks,
}: {
  recentActivity: PmRecentClickupActivity[];
  slackSignals: Array<ProjectSlackEvent & { project_name: string; channel_name: string | null }>;
  staleTasks: PmStaleClickupTask[];
}) {
  return (
    <Accordion type="multiple" defaultValue={["clickup"]} className="rounded-lg border border-border">
      <AccordionItem value="clickup" className="px-3">
        <AccordionTrigger className="py-2 text-xs hover:no-underline">
          Recent ClickUp Signals ({recentActivity.length})
        </AccordionTrigger>
        <AccordionContent className="space-y-2 pb-3">
          {recentActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent ClickUp activity.</p>
          ) : (
            recentActivity.map((event) => (
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
        <AccordionTrigger className="py-2 text-xs hover:no-underline">
          Recent Slack Signals ({slackSignals.length})
        </AccordionTrigger>
        <AccordionContent className="space-y-2 pb-3">
          {slackSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No meaningful Slack signals yet.</p>
          ) : (
            slackSignals.map((event) => (
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
        <AccordionTrigger className="py-2 text-xs hover:no-underline">
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
  );
}

function DailyPlanContent({ plan }: { plan: PmDailyPlan }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Generated {formatDistanceToNow(new Date(plan.created_at), { addSuffix: true })}
      </p>
      {plan.summary && <p className="text-sm leading-relaxed">{plan.summary}</p>}
      {plan.top_priorities.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1">Top priorities</p>
          <ul className="space-y-1">
            {plan.top_priorities.map((item, i) => (
              <li key={`${i}-${item.slice(0, 20)}`} className="text-xs text-muted-foreground">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.suggested_order.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Suggested order: {plan.suggested_order.join(" → ")}
        </p>
      )}
      {plan.project_focus.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Project focus</p>
          {plan.project_focus.map((focus) => (
            <div key={focus.project_id} className="rounded-md border border-border/60 p-2 text-xs">
              <p className="font-medium">{focus.project_name}</p>
              <p className="text-muted-foreground mt-0.5">{focus.reason}</p>
              <p className="mt-1">{focus.recommended_action}</p>
            </div>
          ))}
        </div>
      )}
      {plan.risks.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1">Risks</p>
          <ul className="space-y-1">
            {plan.risks.map((risk, i) => (
              <li key={`${i}-${risk.slice(0, 16)}`} className="text-xs text-muted-foreground">
                • {risk}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface PmCommandCenterDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: PmCommandCenterDrawerTab;
  onTabChange: (tab: PmCommandCenterDrawerTab) => void;
  openActions: PmOpenActionItem[];
  attentionProjects: PmProjectAttention[];
  recentActivity: PmRecentClickupActivity[];
  slackSignals: Array<ProjectSlackEvent & { project_name: string; channel_name: string | null }>;
  staleTasks: PmStaleClickupTask[];
  dailyPlan: PmDailyPlan | null;
  busy: boolean;
  onOpenProject: (projectId: string) => void;
  onCopyAction: (item: PmOpenActionItem) => void;
  onDismissAction: (item: PmOpenActionItem) => void;
}

export function PmCommandCenterDetailDrawer({
  open,
  onOpenChange,
  tab,
  onTabChange,
  openActions,
  attentionProjects,
  recentActivity,
  slackSignals,
  staleTasks,
  dailyPlan,
  busy,
  onOpenProject,
  onCopyAction,
  onDismissAction,
}: PmCommandCenterDetailDrawerProps) {
  return (
    <EntityDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="PM Command Center"
      description="Actions, projects, and signal diagnostics"
    >
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as PmCommandCenterDrawerTab)}>
        <TabsList className="mb-4 h-8 w-full justify-start">
          <TabsTrigger value="actions" className="text-xs">
            Actions ({openActions.length})
          </TabsTrigger>
          <TabsTrigger value="attention" className="text-xs">
            Attention ({attentionProjects.length})
          </TabsTrigger>
          <TabsTrigger value="signals" className="text-xs">
            Signals
          </TabsTrigger>
          {dailyPlan && (
            <TabsTrigger value="plan" className="text-xs">
              Today's plan
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="actions" className="mt-0 space-y-1">
          {openActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open PM actions.</p>
          ) : (
            openActions.map((item) => (
              <CompactPriorityActionRow
                key={item.id}
                item={item}
                busy={busy}
                showSource
                onOpen={() => onOpenProject(item.project_id)}
                onCopy={() => onCopyAction(item)}
                onDismiss={() => onDismissAction(item)}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="attention" className="mt-0 space-y-2">
          {attentionProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">All projects look stable.</p>
          ) : (
            attentionProjects.map((project) => (
              <FullAttentionRow
                key={project.project_id}
                project={project}
                onOpen={() => onOpenProject(project.project_id)}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="signals" className="mt-0">
          <SignalDiagnosticsContent
            recentActivity={recentActivity}
            slackSignals={slackSignals}
            staleTasks={staleTasks}
          />
        </TabsContent>

        {dailyPlan && (
          <TabsContent value="plan" className="mt-0">
            <DailyPlanContent plan={dailyPlan} />
          </TabsContent>
        )}
      </Tabs>
    </EntityDrawer>
  );
}

type MetricKey = "needingAttention" | "urgentBlockers" | "clientQuestions" | "needsAnalysis" | "staleTasks";

const METRIC_CONFIG: {
  key: MetricKey;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  tab: PmCommandCenterDrawerTab;
  urgent?: boolean;
}[] = [
  {
    key: "needingAttention",
    label: "Need attention",
    shortLabel: "need attention",
    icon: <AlertTriangle className="h-3 w-3" />,
    tab: "attention",
  },
  {
    key: "urgentBlockers",
    label: "Blockers",
    shortLabel: "blockers",
    icon: <ShieldAlert className="h-3 w-3" />,
    tab: "actions",
    urgent: true,
  },
  {
    key: "clientQuestions",
    label: "Client questions",
    shortLabel: "client questions",
    icon: <MessageSquare className="h-3 w-3" />,
    tab: "actions",
  },
  {
    key: "needsAnalysis",
    label: "Needs analysis",
    shortLabel: "need analysis",
    icon: <RefreshCw className="h-3 w-3" />,
    tab: "attention",
  },
  {
    key: "staleTasks",
    label: "Stale tasks",
    shortLabel: "stale",
    icon: <AlertCircle className="h-3 w-3" />,
    tab: "signals",
  },
];

export function CompactMetricsRow({
  metrics,
  hideZeros,
  onMetricClick,
}: {
  metrics: Record<MetricKey, number>;
  hideZeros: boolean;
  onMetricClick: (tab: PmCommandCenterDrawerTab) => void;
}) {
  const visible = METRIC_CONFIG.filter((m) => !hideZeros || metrics[m.key] > 0);

  if (visible.length === 0) {
    return null;
  }

  if (hideZeros) {
    return (
      <p className="text-xs text-muted-foreground">
        {visible.map((m, i) => (
          <React.Fragment key={m.key}>
            {i > 0 && " · "}
            <button
              type="button"
              onClick={() => onMetricClick(m.tab)}
              className={cn(
                "hover:text-foreground transition-colors underline-offset-2 hover:underline",
                m.urgent && metrics[m.key] > 0 && "text-destructive font-medium",
              )}
            >
              <span className="font-serif tabular-nums">{metrics[m.key]}</span> {m.shortLabel}
            </button>
          </React.Fragment>
        ))}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      {visible.map((m, i) => (
        <React.Fragment key={m.key}>
          {i > 0 && <span className="text-border px-0.5" aria-hidden>|</span>}
          <button
            type="button"
            onClick={() => onMetricClick(m.tab)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/50 transition-colors",
              metrics[m.key] === 0 && "text-muted-foreground/60",
              m.urgent && metrics[m.key] > 0 && "text-destructive",
            )}
            aria-label={`${m.label}: ${metrics[m.key]}`}
          >
            <span className="text-muted-foreground">{m.icon}</span>
            <span className="text-muted-foreground">{m.label}</span>
            <span className="font-serif font-semibold tabular-nums">{metrics[m.key]}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export function SignalDiagnosticsTrigger({
  clickupCount,
  slackCount,
  staleCount,
  onClick,
}: {
  clickupCount: number;
  slackCount: number;
  staleCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
      aria-label="View signal diagnostics"
    >
      Signal diagnostics · {clickupCount} ClickUp · {slackCount} Slack · {staleCount} stale
    </button>
  );
}
