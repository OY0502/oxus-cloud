import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectAvatar } from "@/components/projects/ProjectAvatar";
import { profileDisplayName } from "@/lib/profiles";
import { barGeometry, type GanttCanvas, type GanttScale } from "@/lib/ganttScale";
import {
  formatDateOnlyLong,
  ganttBarOrdinals,
  getProjectTimelineState,
  ongoingDisplayEndYear,
} from "@/lib/projectTimelineState";
import type { ProjectWithAssignees } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 52;
const LABEL_WIDTH = 240;

interface ProjectGanttRowProps {
  project: ProjectWithAssignees;
  canvas: GanttCanvas;
  scale: GanttScale;
  canvasWidth: number;
  onOpen: (project: ProjectWithAssignees) => void;
}

function barClass(state: ReturnType<typeof getProjectTimelineState>["state"], archived: boolean): string {
  const base = "absolute top-1/2 -translate-y-1/2 h-7 rounded-md border transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (archived) return cn(base, "bg-muted/80 border-border/60 opacity-70");
  switch (state) {
    case "completed":
      return cn(base, "bg-soft-green/25 border-soft-green/40");
    case "overdue":
      return cn(base, "bg-destructive/15 border-destructive/35");
    case "ongoing":
      return cn(base, "bg-primary/20 border-primary/30 border-dashed");
    case "scheduled":
      return cn(base, "bg-muted border-border/60");
    case "invalid_dates":
      return cn(base, "bg-destructive/10 border-destructive/30 border-dashed");
    default:
      return cn(base, "bg-primary/25 border-primary/35");
  }
}

export function ProjectGanttRow({ project, canvas, scale, canvasWidth, onOpen }: ProjectGanttRowProps) {
  const timeline = useMemo(
    () =>
      getProjectTimelineState({
        startDate: project.start_date,
        deadline: project.deadline,
        status: project.status,
        archivedAt: project.archived_at,
      }),
    [project.start_date, project.deadline, project.status, project.archived_at],
  );

  const ordinals = ganttBarOrdinals(timeline);
  const geom = ordinals
    ? barGeometry(ordinals.start, ordinals.end, canvas, scale)
    : { left: 0, width: 0, visible: false };

  const elapsedWidth =
    geom.visible && timeline.elapsed_percentage != null && timeline.show_progress_bar
      ? (geom.width * timeline.elapsed_percentage) / 100
      : null;

  const ongoingYear = ongoingDisplayEndYear(timeline);
  const owner = project.owner ? profileDisplayName(project.owner) : "—";

  const tooltip = (
    <div className="space-y-1 text-xs max-w-[260px]">
      <p className="font-semibold">{project.name}</p>
      <p>Start: {formatDateOnlyLong(project.start_date)}</p>
      <p>Deadline: {project.deadline ? formatDateOnlyLong(project.deadline) : "None"}</p>
      <p>State: {timeline.label}</p>
      {timeline.elapsed_percentage != null && timeline.show_progress_bar && (
        <p>Elapsed: {timeline.elapsed_percentage}%</p>
      )}
      {timeline.days_remaining != null && timeline.state === "in_progress" && (
        <p>{timeline.days_remaining} days remaining</p>
      )}
      {timeline.days_overdue != null && <p>{timeline.days_overdue} days overdue</p>}
      {ongoingYear != null && (
        <p className="text-muted-foreground">No deadline set. Displayed through 31 Dec {ongoingYear}.</p>
      )}
      <p>Owner: {owner}</p>
      <p className="capitalize">Status: {project.status.replace("-", " ")}</p>
      <p className="capitalize">Priority: {project.priority}</p>
    </div>
  );

  return (
    <div className="flex border-b border-border/50" style={{ height: ROW_HEIGHT }}>
      <div
        className="sticky left-0 z-10 flex items-center gap-2 px-3 border-r border-border/60 bg-card shrink-0"
        style={{ width: LABEL_WIDTH }}
      >
        <ProjectAvatar project={project} size="xs" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="text-sm font-medium truncate block w-full text-left hover:underline"
            onClick={() => onOpen(project)}
          >
            {project.name}
          </button>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-muted-foreground capitalize truncate">
              {project.status.replace("-", " ")}
            </span>
            {project.archived_at && (
              <Badge variant="secondary" className="text-[9px] uppercase px-1 py-0">
                Archived
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="relative shrink-0" style={{ width: canvasWidth }}>
        {geom.visible && ordinals && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={barClass(timeline.state, !!project.archived_at)}
                  style={{ left: geom.left, width: geom.width }}
                  onClick={() => onOpen(project)}
                  aria-label={`${project.name}: ${timeline.label}`}
                >
                  {elapsedWidth != null && elapsedWidth > 0 && (
                    <span
                      className="absolute inset-y-0 left-0 rounded-l-md bg-primary/35 pointer-events-none"
                      style={{ width: Math.min(elapsedWidth, geom.width) }}
                    />
                  )}
                  {timeline.state === "ongoing" && (
                    <span
                      className="absolute inset-y-0 right-0 w-3 rounded-r-md bg-gradient-to-r from-transparent to-primary/20 pointer-events-none"
                      aria-hidden
                    />
                  )}
                  <span className="relative z-[1] px-2 text-[10px] font-medium truncate text-foreground/90">
                    {timeline.state === "ongoing"
                      ? "Ongoing"
                      : timeline.state === "overdue"
                        ? "Overdue"
                        : timeline.elapsed_percentage != null && geom.width > 48
                          ? `${timeline.elapsed_percentage}%`
                          : ""}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

export { ROW_HEIGHT, LABEL_WIDTH };
