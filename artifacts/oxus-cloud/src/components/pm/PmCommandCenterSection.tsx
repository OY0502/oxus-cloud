import React, { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import type { PmOpenActionItem } from "@/lib/types";
import { copyTextForPmAction } from "@/lib/pmActions";
import {
  computePmCommandCenterMetrics,
  isPmCommandCenterAllClear,
  pmCommandCenterCollapsedSummary,
  resolveInitialPmCommandCenterCollapsed,
} from "@/lib/pmCommandCenterMetrics";
import {
  readPmCommandCenterCollapseState,
  writePmCommandCenterCollapseState,
} from "@/lib/pmCommandCenterStorage";
import {
  CompactAttentionRow,
  CompactMetricsRow,
  CompactPriorityActionRow,
  PmCommandCenterDetailDrawer,
  SignalDiagnosticsTrigger,
  type PmCommandCenterDrawerTab,
} from "@/components/pm/PmCommandCenterDetailDrawer";
import { cn } from "@/lib/utils";

const PRIORITY_PREVIEW = 3;
const ATTENTION_PREVIEW = 3;

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

  const metrics = useMemo(
    () => computePmCommandCenterMetrics(openActions, attentionProjects, staleTasks),
    [openActions, attentionProjects, staleTasks],
  );

  const allClear = isPmCommandCenterAllClear(metrics, openActions.length);
  const collapsedSummary = pmCommandCenterCollapsedSummary(metrics);

  const [collapsed, setCollapsed] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<PmCommandCenterDrawerTab>("actions");

  useEffect(() => {
    if (actionsLoading || attentionLoading || initialized) return;
    const stored = readPmCommandCenterCollapseState();
    setCollapsed(resolveInitialPmCommandCenterCollapsed(stored, metrics, openActions.length));
    setInitialized(true);
  }, [actionsLoading, attentionLoading, initialized, metrics, openActions.length]);

  const topPriorities = useMemo(() => openActions.slice(0, PRIORITY_PREVIEW), [openActions]);
  const previewAttention = useMemo(
    () => attentionProjects.slice(0, ATTENTION_PREVIEW),
    [attentionProjects],
  );

  const busy = updateAction.isPending || generatePlan.isPending;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writePmCommandCenterCollapseState(next, true);
  };

  const openDrawer = (tab: PmCommandCenterDrawerTab) => {
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

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
      setDrawerTab("plan");
      setDrawerOpen(true);
    } catch (e) {
      toast({ title: "Plan generation failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const loading = actionsLoading || attentionLoading;

  return (
    <>
      <section
        className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 md:px-4"
        aria-label="PM Command Center"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <h2 className="text-sm font-medium">PM Command Center</h2>
            {allClear && (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                · All clear
              </span>
            )}
            {collapsed && !allClear && collapsedSummary && (
              <span className="hidden text-xs text-muted-foreground sm:inline truncate">
                · {collapsedSummary}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!planLoading && dailyPlan && collapsed && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs hidden sm:inline-flex"
                onClick={() => openDrawer("plan")}
              >
                View plan
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              onClick={generateDailyPlan}
              disabled={generatePlan.isPending}
              aria-label={generatePlan.isPending ? "Generating today's plan" : "Generate today's plan"}
            >
              <Sparkles className={cn("h-3.5 w-3.5", generatePlan.isPending && "animate-pulse")} />
              <span className="hidden sm:inline">
                {generatePlan.isPending ? "Generating…" : "Generate today's plan"}
              </span>
              <span className="sm:hidden">{generatePlan.isPending ? "…" : "Plan"}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand PM Command Center" : "Collapse PM Command Center"}
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {collapsed && !allClear && collapsedSummary && (
          <p className="mt-1 text-xs text-muted-foreground sm:hidden">{collapsedSummary}</p>
        )}

        {generatePlan.isError && (
          <Alert variant="destructive" className="mt-2 py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            <AlertTitle className="text-xs">Plan generation failed</AlertTitle>
            <AlertDescription className="text-[11px]">{generatePlan.error.message}</AlertDescription>
          </Alert>
        )}

        {/* Expanded content */}
        {!collapsed && (
          <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (
              <>
                <CompactMetricsRow
                  metrics={metrics}
                  hideZeros={false}
                  onMetricClick={openDrawer}
                />

                {!planLoading && dailyPlan && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-primary/5 px-2 py-1.5 text-xs">
                    <span className="font-medium text-primary/90">Today's plan</span>
                    {dailyPlan.summary && (
                      <span className="text-muted-foreground line-clamp-1 flex-1 min-w-0">
                        {dailyPlan.summary}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(dailyPlan.created_at), { addSuffix: true })}
                    </span>
                    <Button
                      size="sm"
                      variant="link"
                      className="h-auto p-0 text-[11px]"
                      onClick={() => openDrawer("plan")}
                    >
                      View full plan
                    </Button>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  {/* Priority */}
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className="text-xs font-medium text-muted-foreground">Priority</h3>
                      {openActions.length > PRIORITY_PREVIEW && (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto p-0 text-[11px]"
                          onClick={() => openDrawer("actions")}
                        >
                          View all PM actions
                        </Button>
                      )}
                    </div>
                    {topPriorities.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-0.5">No open PM actions</p>
                    ) : (
                      topPriorities.map((item) => (
                        <CompactPriorityActionRow
                          key={item.id}
                          item={item}
                          busy={busy}
                          onOpen={() => navigate(`/projects/${item.project_id}`)}
                          onCopy={() => copyAction(item)}
                          onDismiss={() => dismissAction(item)}
                        />
                      ))
                    )}
                  </div>

                  {/* Attention */}
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className="text-xs font-medium text-muted-foreground">
                        Projects needing attention
                      </h3>
                      {attentionProjects.length > ATTENTION_PREVIEW && (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto p-0 text-[11px]"
                          onClick={() => openDrawer("attention")}
                        >
                          View all
                        </Button>
                      )}
                    </div>
                    {previewAttention.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-0.5">All projects look stable</p>
                    ) : (
                      previewAttention.map((project) => (
                        <CompactAttentionRow
                          key={project.project_id}
                          project={project}
                          onOpen={() => navigate(`/projects/${project.project_id}`)}
                        />
                      ))
                    )}
                  </div>
                </div>

                <SignalDiagnosticsTrigger
                  clickupCount={recentActivity.length}
                  slackCount={slackSignals.length}
                  staleCount={staleTasks.length}
                  onClick={() => openDrawer("signals")}
                />
              </>
            )}
          </div>
        )}

        {/* Collapsed: still show compact metrics for non-zero when not all clear */}
        {collapsed && !allClear && !loading && (
          <div className="mt-1">
            <CompactMetricsRow metrics={metrics} hideZeros onMetricClick={openDrawer} />
          </div>
        )}
      </section>

      <PmCommandCenterDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        tab={drawerTab}
        onTabChange={setDrawerTab}
        openActions={openActions}
        attentionProjects={attentionProjects}
        recentActivity={recentActivity}
        slackSignals={slackSignals}
        staleTasks={staleTasks}
        dailyPlan={dailyPlan}
        busy={busy}
        onOpenProject={(id) => {
          setDrawerOpen(false);
          navigate(`/projects/${id}`);
        }}
        onCopyAction={copyAction}
        onDismissAction={dismissAction}
      />
    </>
  );
}
