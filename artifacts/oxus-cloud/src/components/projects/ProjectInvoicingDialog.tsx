import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  RefreshCw,
} from "lucide-react";
import { useProjectInvoicing } from "@/hooks/api";
import {
  buildInvoicingReport,
  formatDuration,
  previousMonthKey,
  type ProjectInvoicingTask,
} from "@/lib/projectInvoicing";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function TaskRow({
  task,
  selected,
  expanded,
  onSelectedChange,
  onExpandedChange,
}: {
  task: ProjectInvoicingTask;
  selected: boolean;
  expanded: boolean;
  onSelectedChange: (selected: boolean) => void;
  onExpandedChange: () => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        selected
          ? "border-info/40 bg-info-muted/45"
          : "border-border bg-card hover:bg-muted/25",
      )}
    >
      <div className="flex items-start gap-3 p-3 sm:items-center">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
          aria-label={`${selected ? "Remove" : "Add"} ${task.name} ${selected ? "from" : "to"} invoice report`}
          className="mt-0.5 sm:mt-0"
        />
        <button
          type="button"
          onClick={onExpandedChange}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-expanded={expanded}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {task.name}
            </span>
            <Badge
              variant="outline"
              className="hidden shrink-0 text-[10px] sm:inline-flex"
            >
              {task.status}
            </Badge>
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-180",
              )}
            />
            {task.description
              ? expanded
                ? "Hide details"
                : "View description"
              : "No description"}
          </span>
        </button>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-right text-xs">
          <div className="min-w-[60px]">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Estimate
            </p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground">
              {formatDuration(task.estimate_ms)}
            </p>
          </div>
          <div className="min-w-[60px]">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Tracked
            </p>
            <p className="mt-0.5 font-semibold tabular-nums text-foreground">
              {formatDuration(task.tracked_ms)}
            </p>
          </div>
        </div>
      </div>
      {expanded && task.description && (
        <div className="border-t border-border/70 bg-background/55 px-11 py-3 text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
          {task.description}
          {task.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex w-fit items-center gap-1 text-xs font-medium text-info hover:underline"
            >
              Open in ClickUp <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectInvoicingDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: Props) {
  const { toast } = useToast();
  const [month, setMonth] = useState(() => previousMonthKey());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const query = useProjectInvoicing(projectId, month, { enabled: open });

  useEffect(() => {
    if (!query.data) return;
    setSelectedIds(new Set(query.data.billing_tasks.map((task) => task.id)));
    setExpandedIds(new Set());
  }, [query.data]);

  const allTasks = useMemo(
    () => [
      ...(query.data?.billing_tasks ?? []),
      ...(query.data?.open_tasks ?? []),
    ],
    [query.data],
  );
  const selectedTasks = useMemo(
    () => allTasks.filter((task) => selectedIds.has(task.id)),
    [allTasks, selectedIds],
  );
  const selectedTracked = selectedTasks.reduce(
    (sum, task) => sum + task.tracked_ms,
    0,
  );
  const selectedEstimate = selectedTasks.reduce(
    (sum, task) => sum + (task.estimate_ms ?? 0),
    0,
  );

  const toggleSelected = (taskId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  };

  const toggleExpanded = (taskId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const copyReport = async () => {
    if (!query.data || selectedTasks.length === 0) return;
    setCopying(true);
    try {
      const report = buildInvoicingReport({
        projectName,
        periodLabel: query.data.period.label,
        tasks: selectedTasks,
      });
      if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([report.text], { type: "text/plain" }),
            "text/html": new Blob([report.html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(report.text);
      }
      toast({
        title: "Invoice report copied",
        description: `${selectedTasks.length} ${selectedTasks.length === 1 ? "task" : "tasks"} ready to paste.`,
      });
    } catch (error) {
      toast({
        title: "Could not copy report",
        description:
          error instanceof Error
            ? error.message
            : "Clipboard access was unavailable.",
        variant: "destructive",
      });
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info-muted text-info">
              <FileText className="h-4.5 w-4.5" />
            </div>
            <div>
              <DialogTitle>Prepare invoicing report</DialogTitle>
              <DialogDescription className="mt-1">
                Review ClickUp work for {projectName}, then copy a client-ready
                time summary.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="border-b border-border/70 bg-muted/20 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="invoicing-month" className="text-xs">
                  Reporting month
                </Label>
                <Input
                  id="invoicing-month"
                  type="month"
                  value={month}
                  onChange={(event) =>
                    event.target.value && setMonth(event.target.value)
                  }
                  className="h-9 w-[175px] bg-background"
                />
              </div>
              <div className="flex items-center gap-2">
                {query.data?.source === "cached" && (
                  <Badge variant="outline">Synced data</Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void query.refetch()}
                  disabled={query.isFetching}
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      query.isFetching && "animate-spin",
                    )}
                  />
                  Refresh
                </Button>
              </div>
            </div>
            {query.data?.warning && (
              <p className="mt-3 rounded-md border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-warning-foreground">
                {query.data.warning}
              </p>
            )}
          </div>

          <div className="space-y-6 px-5 py-5 sm:px-6">
            {query.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
              </div>
            ) : query.isError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm">
                <p className="font-medium text-foreground">
                  Couldn&apos;t load ClickUp tasks
                </p>
                <p className="mt-1 text-muted-foreground">
                  {query.error instanceof Error
                    ? query.error.message
                    : "Please try again."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => void query.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : !query.data?.linked ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <Clock3 className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  Connect this project to ClickUp first
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Once a ClickUp list is linked, billing-ready and open tasks
                  will appear here.
                </p>
              </div>
            ) : (
              <>
                <section aria-labelledby="billing-ready-heading">
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h3
                        id="billing-ready-heading"
                        className="text-sm font-semibold"
                      >
                        Billing-ready tasks
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Tasks with ClickUp status “Billing” are selected
                        automatically.
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {query.data.billing_tasks.length} found
                    </span>
                  </div>
                  {query.data.billing_tasks.length > 0 ? (
                    <div className="space-y-2">
                      {query.data.billing_tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          selected={selectedIds.has(task.id)}
                          expanded={expandedIds.has(task.id)}
                          onSelectedChange={(selected) =>
                            toggleSelected(task.id, selected)
                          }
                          onExpandedChange={() => toggleExpanded(task.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                      No tasks currently have the “Billing” status.
                    </div>
                  )}
                </section>

                <section
                  aria-labelledby="open-tasks-heading"
                  className="border-t border-border/70 pt-5"
                >
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h3
                        id="open-tasks-heading"
                        className="text-sm font-semibold"
                      >
                        Other open tasks
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Optionally include unfinished work that should be
                        invoiced this period.
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {query.data.open_tasks.length} available
                    </span>
                  </div>
                  {query.data.open_tasks.length > 0 ? (
                    <div className="space-y-2">
                      {query.data.open_tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          selected={selectedIds.has(task.id)}
                          expanded={expandedIds.has(task.id)}
                          onSelectedChange={(selected) =>
                            toggleSelected(task.id, selected)
                          }
                          onExpandedChange={() => toggleExpanded(task.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                      No other unfinished tasks found.
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-background px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-xs text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">
                {selectedTasks.length}
              </span>{" "}
              selected
            </p>
            <p className="mt-0.5 tabular-nums">
              {formatDuration(selectedTracked)} tracked ·{" "}
              {formatDuration(selectedEstimate)} estimated
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="gap-2"
              onClick={() => void copyReport()}
              disabled={copying || selectedTasks.length === 0}
            >
              {copying ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copying ? "Copying…" : "Copy report"}
              {!copying && selectedTasks.length > 0 && (
                <Check className="hidden h-3.5 w-3.5 opacity-60 sm:block" />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
