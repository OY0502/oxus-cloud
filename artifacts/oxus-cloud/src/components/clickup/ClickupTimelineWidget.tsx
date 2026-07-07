import React, { useMemo } from "react";
import { ArrowDown, ArrowUp, Clock, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProjectClickupTimeline } from "@/hooks/api";
import type { ProjectClickupTimelineEvent } from "@/lib/types";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";

function DirectionBadge({ direction }: { direction: "to_clickup" | "from_clickup" }) {
  return direction === "to_clickup" ? (
    <Badge variant="outline" className="gap-0.5 text-[9px] h-4 px-1">
      <ArrowUp className="h-2 w-2" /> Out
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-0.5 text-[9px] h-4 px-1">
      <ArrowDown className="h-2 w-2" /> In
    </Badge>
  );
}

function dayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d, yyyy");
}

function taskTitle(event: ProjectClickupTimelineEvent): string | null {
  const payload = event.raw_payload as any;
  const name = payload?.task?.name ?? payload?.name ?? payload?.task_name ?? null;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function rawPayloadPreview(event: ProjectClickupTimelineEvent): string {
  try {
    return JSON.stringify(event.raw_payload, null, 2).slice(0, 1600);
  } catch {
    return "Raw payload unavailable.";
  }
}

function CompactTimelineRow({ event }: { event: ProjectClickupTimelineEvent }) {
  const date = event.clickup_date ?? event.created_at;
  const title = taskTitle(event);
  return (
    <div className="py-2 border-b border-border/60 last:border-0">
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-medium leading-snug line-clamp-2">{event.event_title}</p>
        <DirectionBadge direction={event.direction} />
      </div>
      {title && (
        <p className="text-[11px] text-foreground/80 line-clamp-1 mt-0.5">{title}</p>
      )}
      {event.event_summary && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{event.event_summary}</p>
      )}
      <p className="text-[10px] text-muted-foreground mt-1">
        {format(new Date(date), "h:mm a")} · {formatDistanceToNow(new Date(date), { addSuffix: true })}
        {event.actor_name && ` · ${event.actor_name}`}
      </p>
      <details className="mt-1 text-[10px] text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Raw payload</summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 whitespace-pre-wrap font-mono">
          {rawPayloadPreview(event)}
        </pre>
      </details>
    </div>
  );
}

export function ClickupTimelineWidget({ projectId, limit = 8 }: { projectId: string; limit?: number }) {
  const { data: timeline = [], isLoading, refetch, isFetching } = useProjectClickupTimeline(projectId);
  const events = timeline.slice(0, limit);
  const groups = useMemo(() => {
    const map = new Map<string, ProjectClickupTimelineEvent[]>();
    for (const event of events) {
      const date = new Date(event.clickup_date ?? event.created_at);
      const key = dayLabel(date);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="section-label">ClickUp Activity</h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center">
          <Clock className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No ClickUp activity yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card px-3 py-1 max-h-[320px] overflow-y-auto">
          {groups.map(([label, groupEvents]) => (
            <div key={label}>
              <p className="sticky top-0 bg-card py-1 section-label text-[10px]">
                {label}
              </p>
              {groupEvents.map((event) => (
                <CompactTimelineRow key={event.id} event={event} />
              ))}
            </div>
          ))}
          {timeline.length > limit && (
            <p className="text-[10px] text-muted-foreground py-2 text-center">
              +{timeline.length - limit} older event(s)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
