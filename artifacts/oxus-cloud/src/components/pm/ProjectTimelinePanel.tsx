import React, { useMemo, useState } from "react";
import { Clock, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProjectTimelineEvents } from "@/hooks/api";
import type { ProjectTimelineEvent, ProjectTimelineFilters, ProjectTimelineSourceType } from "@/lib/types";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";

const SOURCE_FILTERS: Array<{ id: ProjectTimelineFilters["sourceType"]; label: string }> = [
  { id: "all", label: "All" },
  { id: "slack", label: "Slack" },
  { id: "clickup", label: "ClickUp" },
  { id: "pm_action", label: "PM Actions" },
];

const TYPE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All types" },
  { id: "blocker", label: "Blockers" },
  { id: "client_question", label: "Questions" },
  { id: "decision", label: "Decisions" },
  { id: "progress_update", label: "Progress" },
  { id: "meeting_needed", label: "Meetings" },
];

function dayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d, yyyy");
}

function sourceBadge(source: ProjectTimelineSourceType) {
  const labels: Record<string, string> = {
    slack: "Slack",
    clickup: "ClickUp",
    pm_action: "PM Action",
    manual: "Manual",
    ai: "AI",
  };
  return (
    <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">
      {labels[source] ?? source.replace(/_/g, " ")}
    </Badge>
  );
}

function TimelineRow({ event }: { event: ProjectTimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const when = event.source_created_at ?? event.created_at;
  const metadata =
    event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};

  return (
    <div className="py-2 border-b border-border/60 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            {sourceBadge(event.source_type)}
            {(event.priority === "high" || event.priority === "urgent") && (
              <Badge variant="destructive" className="text-[9px] h-4 px-1 capitalize">
                {event.priority}
              </Badge>
            )}
            {event.signal_type && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                {event.signal_type.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <p className="text-xs font-medium leading-snug">{event.event_title}</p>
          {event.event_summary && (
            <p className="text-[11px] text-muted-foreground line-clamp-2">{event.event_summary}</p>
          )}
        </div>
        {event.source_url && (
          <a
            href={event.source_url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Open source"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        {format(new Date(when), "h:mm a")} · {formatDistanceToNow(new Date(when), { addSuffix: true })}
        {event.actor_name && ` · ${event.actor_name}`}
      </p>
      {(event.event_body || Object.keys(metadata).length > 0) && (
        <button
          type="button"
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide details" : "View details"}
        </button>
      )}
      {expanded && (
        <div className="mt-1 rounded-md bg-muted/30 p-2 text-[11px] space-y-1">
          {event.event_body && (
            <p className="whitespace-pre-wrap text-foreground/90">{event.event_body}</p>
          )}
          {typeof metadata.channel_name === "string" && (
            <p className="text-muted-foreground">Channel: #{metadata.channel_name}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectTimelinePanel({ projectId, limit = 12 }: { projectId: string; limit?: number }) {
  const [sourceFilter, setSourceFilter] = useState<ProjectTimelineFilters["sourceType"]>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const filters = useMemo<ProjectTimelineFilters>(
    () => ({ sourceType: sourceFilter, signalType: typeFilter }),
    [sourceFilter, typeFilter],
  );
  const { data: timeline = [], isLoading, refetch, isFetching } = useProjectTimelineEvents(projectId, filters);
  const events = timeline.slice(0, limit);

  const groups = useMemo(() => {
    const map = new Map<string, ProjectTimelineEvent[]>();
    for (const event of events) {
      const date = new Date(event.source_created_at ?? event.created_at);
      const key = dayLabel(date);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Project Timeline</h4>
          <p className="text-xs text-muted-foreground">
            Meaningful updates from ClickUp, Slack, and project intelligence
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] gap-1 shrink-0"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {SOURCE_FILTERS.map((filter) => (
          <Button
            key={filter.id ?? "all"}
            size="sm"
            variant={sourceFilter === filter.id ? "secondary" : "outline"}
            className="h-6 px-2 text-[10px]"
            onClick={() => setSourceFilter(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {TYPE_FILTERS.map((filter) => (
          <Button
            key={filter.id}
            size="sm"
            variant={typeFilter === filter.id ? "secondary" : "ghost"}
            className="h-6 px-2 text-[10px]"
            onClick={() => setTypeFilter(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center">
          <Clock className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No timeline events yet.</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Sync Slack or ClickUp, then reprocess signals to populate meaningful updates.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card px-3 py-1 max-h-[420px] overflow-y-auto">
          {groups.map(([label, groupEvents]) => (
            <div key={label}>
              <p className="sticky top-0 bg-card py-1 section-label text-[10px]">
                {label}
              </p>
              {groupEvents.map((event) => (
                <TimelineRow key={event.id} event={event} />
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
