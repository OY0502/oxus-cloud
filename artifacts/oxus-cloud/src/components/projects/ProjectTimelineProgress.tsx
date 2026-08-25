import React from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types";
import {
  formatDateOnly,
  getProjectTimelineState,
  type ProjectTimelineState,
} from "@/lib/projectTimelineState";

export interface ProjectTimelineInputProps {
  startDate: string | null | undefined;
  deadline: string | null | undefined;
  status?: ProjectStatus | string | null;
  archivedAt?: string | null;
  today?: string;
}

function useTimeline(input: ProjectTimelineInputProps): ProjectTimelineState {
  return getProjectTimelineState({
    startDate: input.startDate,
    deadline: input.deadline,
    status: input.status,
    archivedAt: input.archivedAt,
    today: input.today,
  });
}

/** Compact text label for timeline state. */
export function ProjectTimelineLabel({
  startDate,
  deadline,
  status,
  archivedAt,
  className,
}: ProjectTimelineInputProps & { className?: string }) {
  const timeline = useTimeline({ startDate, deadline, status, archivedAt });

  return (
    <span
      className={cn(
        "text-xs",
        timeline.state === "overdue" && "text-destructive font-medium",
        timeline.state === "ongoing" && "text-muted-foreground",
        timeline.state === "not_scheduled" && "text-muted-foreground italic",
        className,
      )}
    >
      {timeline.label}
    </span>
  );
}

type Variant = "compact" | "detail";

/** Shared timeline progress display for table, board, and detail views. */
export function ProjectTimelineProgress({
  startDate,
  deadline,
  status,
  archivedAt,
  variant = "compact",
  className,
}: ProjectTimelineInputProps & { variant?: Variant; className?: string }) {
  const timeline = useTimeline({ startDate, deadline, status, archivedAt });

  if (variant === "detail") {
    return <ProjectTimelineDetail timeline={timeline} className={className} />;
  }

  return <ProjectTimelineCompact timeline={timeline} className={className} />;
}

function ProjectTimelineCompact({
  timeline,
  className,
}: {
  timeline: ProjectTimelineState;
  className?: string;
}) {
  if (timeline.state === "not_scheduled") {
    return (
      <div className={cn("text-xs text-muted-foreground italic", className)}>Not scheduled</div>
    );
  }

  if (timeline.state === "incomplete_dates") {
    return (
      <div className={cn("space-y-0.5", className)}>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Due {formatDateOnly(timeline.deadline)}</span>
        </div>
        <span className="text-xs text-amber-600 dark:text-amber-400">Start date missing</span>
      </div>
    );
  }

  if (timeline.state === "invalid_dates") {
    return (
      <div className={cn("text-xs text-destructive", className)}>Invalid dates — deadline before start</div>
    );
  }

  if (timeline.state === "ongoing" || (timeline.state === "completed" && !timeline.deadline)) {
    return (
      <div className={cn("space-y-0.5", className)}>
        <div className="text-xs text-muted-foreground">Started {formatDateOnly(timeline.start_date)}</div>
        <span className="text-xs font-medium text-muted-foreground">{timeline.label}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5 w-full max-w-[220px]", className)}>
      <div className="flex justify-between text-xs text-muted-foreground gap-2">
        <span className="truncate">{formatDateOnly(timeline.start_date)}</span>
        <span className="truncate">{formatDateOnly(timeline.deadline)}</span>
      </div>
      {timeline.show_progress_bar && timeline.elapsed_percentage != null ? (
        <div className="flex items-center gap-2">
          <Progress
            value={timeline.elapsed_percentage}
            className={cn(
              "h-1.5 flex-1",
              timeline.state === "overdue" && "[&>div]:bg-destructive/70",
              timeline.state === "completed" && "[&>div]:bg-soft-green",
            )}
          />
          <span
            className={cn(
              "text-xs tabular-nums shrink-0",
              timeline.state === "overdue" ? "text-destructive font-medium" : "text-foreground",
            )}
          >
            {timeline.state === "overdue" ? timeline.label : `${timeline.elapsed_percentage}%`}
          </span>
        </div>
      ) : (
        <ProjectTimelineLabel startDate={timeline.start_date} deadline={timeline.deadline} />
      )}
    </div>
  );
}

function ProjectTimelineDetail({
  timeline,
  className,
}: {
  timeline: ProjectTimelineState;
  className?: string;
}) {
  if (timeline.state === "not_scheduled") {
    return (
      <div className={cn("space-y-1", className)}>
        <p className="text-sm font-semibold text-muted-foreground italic">Not scheduled</p>
        <p className="text-xs text-muted-foreground">Add start and deadline dates to track timeline progress.</p>
      </div>
    );
  }

  if (timeline.state === "incomplete_dates") {
    return (
      <div className={cn("space-y-1", className)}>
        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Start date missing</p>
        <p className="text-xs text-muted-foreground">Deadline: {formatDateOnly(timeline.deadline)}</p>
      </div>
    );
  }

  if (timeline.state === "invalid_dates") {
    return (
      <div className={cn("space-y-1", className)}>
        <p className="text-sm font-semibold text-destructive">Invalid dates</p>
        <p className="text-xs text-muted-foreground">Deadline is before the start date. Edit the project to fix.</p>
      </div>
    );
  }

  if (timeline.state === "ongoing") {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-muted-foreground">Ongoing</span>
        </div>
        <p className="text-xs text-muted-foreground">No deadline set</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">
          {timeline.state === "overdue"
            ? timeline.label
            : timeline.state === "completed"
              ? "Completed"
              : `${timeline.elapsed_percentage}% elapsed`}
        </span>
        {timeline.days_remaining != null && timeline.state === "in_progress" && (
          <span className="text-xs text-muted-foreground">{timeline.days_remaining} days left</span>
        )}
      </div>
      {timeline.show_progress_bar && timeline.elapsed_percentage != null && (
        <Progress
          value={timeline.elapsed_percentage}
          className={cn(
            "h-3 bg-muted",
            timeline.state === "overdue" ? "[&>div]:bg-destructive/70" : "[&>div]:bg-soft-green",
          )}
        />
      )}
      {timeline.state === "scheduled" && (
        <p className="text-xs text-muted-foreground">{timeline.label}</p>
      )}
    </div>
  );
}

export { getProjectTimelineState };
