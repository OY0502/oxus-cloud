import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TablePagination } from "@/components/TablePagination";
import { ProjectGanttToolbar } from "@/components/projects/gantt/ProjectGanttToolbar";
import { ProjectGanttRow, LABEL_WIDTH, ROW_HEIGHT } from "@/components/projects/gantt/ProjectGanttRow";
import { UnscheduledProjectsList } from "@/components/projects/gantt/UnscheduledProjectsList";
import {
  buildDayGridLines,
  buildGanttHeaders,
  buildGanttMonthBands,
  computeGanttCanvas,
  ganttCanvasWidth,
  ganttPixelsPerDay,
  headerCellWidth,
  readGanttScale,
  scrollLeftForOrdinal,
  todayMarkerLeft,
  writeGanttScale,
  type GanttScale,
} from "@/lib/ganttScale";
import { dateOnlyOrdinal, parseDateOnly, todayInProductTimezone } from "@/lib/projectDates";
import { getProjectTimelineState, ganttBarOrdinals, todayOrdinal } from "@/lib/projectTimelineState";
import type { ProjectWithAssignees } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

interface ProjectGanttProps {
  projects: ProjectWithAssignees[];
  onOpen: (project: ProjectWithAssignees) => void;
  onEdit?: (project: ProjectWithAssignees) => void;
}

export function ProjectGantt({ projects, onOpen, onEdit }: ProjectGanttProps) {
  const [scale, setScale] = useState<GanttScale>(() => readGanttScale());
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    writeGanttScale(scale);
  }, [scale]);

  useEffect(() => {
    setPage(1);
    didInitialScroll.current = false;
  }, [projects.length, scale]);

  const { scheduled, unscheduled } = useMemo(() => {
    const sched: ProjectWithAssignees[] = [];
    const unsched: ProjectWithAssignees[] = [];
    for (const p of projects) {
      const t = getProjectTimelineState({
        startDate: p.start_date,
        deadline: p.deadline,
        status: p.status,
        archivedAt: p.archived_at,
      });
      if (t.gantt_schedulable) sched.push(p);
      else unsched.push(p);
    }
    return { scheduled: sched, unscheduled: unsched };
  }, [projects]);

  const dataRange = useMemo(() => {
    let min = todayOrdinal();
    let max = min;
    for (const p of scheduled) {
      const t = getProjectTimelineState({
        startDate: p.start_date,
        deadline: p.deadline,
        status: p.status,
      });
      const ord = ganttBarOrdinals(t);
      if (!ord) continue;
      min = Math.min(min, ord.start);
      max = Math.max(max, ord.end);
    }
    return { min, max };
  }, [scheduled]);

  const canvas = useMemo(
    () => computeGanttCanvas(scale, todayInProductTimezone(), dataRange.min, dataRange.max),
    [scale, dataRange.min, dataRange.max],
  );

  const canvasWidth = ganttCanvasWidth(canvas, scale);
  const px = ganttPixelsPerDay(scale);

  const headers = useMemo(() => buildGanttHeaders(canvas, scale), [canvas, scale]);
  const monthBands = useMemo(() => buildGanttMonthBands(canvas, scale), [canvas, scale]);
  const dayGridLines = useMemo(() => buildDayGridLines(canvas, scale), [canvas, scale]);
  const todayLeft = todayMarkerLeft(canvas, scale);

  const scrollToOrdinal = useCallback(
    (ordinal: number, behavior: ScrollBehavior = "smooth") => {
      const el = scrollRef.current;
      if (!el) return;
      const left = scrollLeftForOrdinal(ordinal, canvas, scale, el.clientWidth);
      el.scrollTo({ left, behavior });
    },
    [canvas, scale],
  );

  useEffect(() => {
    if (didInitialScroll.current) return;
    const todayOrd = dateOnlyOrdinal(parseDateOnly(todayInProductTimezone())!);
    scrollToOrdinal(todayOrd, "auto");
    didInitialScroll.current = true;
  }, [canvas, scale, scrollToOrdinal]);

  const totalPages = Math.max(1, Math.ceil(scheduled.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = scheduled.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const scrollByViewport = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.75, behavior: "smooth" });
  };

  const jumpToday = () => {
    const todayOrd = dateOnlyOrdinal(parseDateOnly(todayInProductTimezone())!);
    scrollToOrdinal(todayOrd);
  };

  return (
    <div className="space-y-0">
      <ProjectGanttToolbar
        scale={scale}
        onScaleChange={(next) => {
          setScale(next);
          didInitialScroll.current = false;
        }}
        onToday={jumpToday}
        onPrevious={() => scrollByViewport(-1)}
        onNext={() => scrollByViewport(1)}
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div ref={scrollRef} className="overflow-x-auto">
            <div style={{ width: LABEL_WIDTH + canvasWidth }}>
              {/* Header */}
              <div className="flex sticky top-0 z-20 bg-muted/95 backdrop-blur-sm border-b border-border">
                <div
                  className="sticky left-0 z-30 shrink-0 px-3 py-2 border-r border-border/60 bg-muted/95 backdrop-blur-sm font-medium text-xs text-muted-foreground flex items-end"
                  style={{ width: LABEL_WIDTH, minHeight: scale === "month" ? 56 : 40 }}
                >
                  Project
                </div>
                <div className="relative shrink-0" style={{ width: canvasWidth }}>
                  {scale === "month" && monthBands.length > 0 && (
                    <div className="flex border-b border-border/40">
                      {monthBands.map((band) => (
                        <div
                          key={band.key}
                          className="shrink-0 px-2 py-1 text-xs font-semibold text-foreground border-r border-border/40 truncate"
                          style={{ width: headerCellWidth(band, scale) }}
                        >
                          {band.label}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="relative flex">
                    {headers.map((cell) => (
                      <div
                        key={cell.key}
                        className={cn(
                          "shrink-0 border-r border-border/40 px-2 py-1.5 text-center",
                          cell.isWeekend && scale === "week" && "bg-muted/40",
                          cell.isToday && "bg-logo-blue/10",
                        )}
                        style={{ width: headerCellWidth(cell, scale) }}
                      >
                        <div className="text-xs font-medium text-foreground whitespace-nowrap">{cell.label}</div>
                        {cell.subLabel && (
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap">{cell.subLabel}</div>
                        )}
                      </div>
                    ))}
                    {todayLeft != null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-logo-blue z-10 pointer-events-none"
                        style={{ left: todayLeft }}
                        aria-hidden
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Grid + rows */}
              <div className="relative">
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-[1]"
                  style={{ left: LABEL_WIDTH, width: canvasWidth }}
                >
                  {(dayGridLines.length > 0 ? dayGridLines : headers).map((cell) => (
                    <div
                      key={`grid-${cell.key}`}
                      className={cn(
                        "absolute top-0 bottom-0 border-r border-border/30",
                        cell.isWeekend && "bg-muted/15",
                        cell.isToday && "bg-logo-blue/5",
                      )}
                      style={{
                        left: (cell.startOrdinal - canvas.start) * px,
                        width: headerCellWidth(cell, scale),
                      }}
                    />
                  ))}
                  {todayLeft != null && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-logo-blue/60"
                      style={{ left: todayLeft }}
                      aria-hidden
                    />
                  )}
                </div>

                {pageItems.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No scheduled projects in this filter.
                  </div>
                ) : (
                  pageItems.map((project) => (
                    <ProjectGanttRow
                      key={project.id}
                      project={project}
                      canvas={canvas}
                      scale={scale}
                      canvasWidth={canvasWidth}
                      onOpen={onOpen}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {scheduled.length > PAGE_SIZE && (
            <TablePagination
              page={safePage}
              pageSize={PAGE_SIZE}
              totalItems={scheduled.length}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>

      <UnscheduledProjectsList projects={unscheduled} onOpen={onOpen} onEdit={onEdit} />
    </div>
  );
}

export { ROW_HEIGHT, LABEL_WIDTH };
