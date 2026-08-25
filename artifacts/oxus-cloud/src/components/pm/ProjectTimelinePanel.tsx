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

function sourceBadge(source: ProjectTimelineSourceType, compact = false) {
  const labels: Record<string, string> = {
    slack: "Slack",
    clickup: "ClickUp",
    pm_action: "PM Action",
    manual: "Manual",
    ai: "AI",
  };
  return (
    <Badge variant="outline" className={compact ? "h-5 px-1.5 text-[11px] font-medium capitalize" : "h-4 px-1 text-[9px] capitalize"}>
      {labels[source] ?? source.replace(/_/g, " ")}
    </Badge>
  );
}

function eventHref(event: ProjectTimelineEvent): string {
  if (event.source_url) return event.source_url;
  if (event.related_clickup_task_id) {
    return `https://app.clickup.com/t/${encodeURIComponent(event.related_clickup_task_id)}`;
  }
  if (event.related_slack_channel_id) {
    const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? event.metadata as Record<string, unknown>
      : {};
    const rawTs = typeof metadata.slack_ts === "string"
      ? metadata.slack_ts
      : typeof metadata.slack_thread_ts === "string"
        ? metadata.slack_thread_ts
        : "";
    const messagePath = rawTs ? `/p${rawTs.replace(".", "")}` : "";
    return `https://slack.com/archives/${encodeURIComponent(event.related_slack_channel_id)}${messagePath}`;
  }
  return `/projects/${event.project_id}`;
}

function informativeEventText(event: ProjectTimelineEvent): string {
  const summary = event.event_summary?.trim();
  if (!summary) return event.event_title;

  if (event.source_type === "clickup" && /status/i.test(event.event_type)) {
    const match = summary.match(/^"([^"]+)" status changed from "([^"]+)"\s*(?:→|to)\s*"([^"]+)"/i);
    if (match) return `Task “${match[1]}” changed from ${match[2]} to ${match[3]}.`;
  }

  if (event.source_type === "clickup" && /comment/i.test(event.event_type)) {
    const taskName = summary.match(/(?:Comment (?:on|posted on|updated on)) "([^"]+)"/i)?.[1];
    const comment = event.event_body?.trim();
    if (comment && taskName) {
      const preview = comment.length > 180 ? `${comment.slice(0, 180)}…` : comment;
      const verb = /updated/i.test(event.event_type) ? "updated" : "added";
      return `Comment “${preview}” was ${verb} on task “${taskName}”.`;
    }
  }

  return summary.replace(/\s+by\s+[^.]+$/i, "").replace(/\s*→\s*/g, " to ");
}

function TimelineRow({ event, compact = false }: { event: ProjectTimelineEvent; compact?: boolean }) {
  const when = event.source_created_at ?? event.created_at;
  const metadata =
    event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};
  const href = eventHref(event);
  const external = /^https?:\/\//i.test(href);

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={compact
        ? "group block border-b border-border/60 py-2.5 transition-colors last:border-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
        : "group block border-b border-border/60 py-2 transition-colors last:border-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"}
      aria-label={`Open activity: ${informativeEventText(event)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            {sourceBadge(event.source_type, compact)}
            {(event.priority === "high" || event.priority === "urgent") && (
              <Badge variant="destructive" className="text-[9px] h-4 px-1 capitalize">
                {event.priority}
              </Badge>
            )}
            {event.signal_type && !compact && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                {event.signal_type.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <p className={compact ? "line-clamp-3 text-sm font-medium leading-5" : "text-xs font-medium leading-snug"}>
            {informativeEventText(event)}
          </p>
        </div>
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>
      <p className={compact ? "mt-1 text-xs text-muted-foreground" : "mt-1 text-[10px] text-muted-foreground"}>
        {format(new Date(when), "h:mm a")} · {formatDistanceToNow(new Date(when), { addSuffix: true })}
        {event.actor_name && ` · ${event.actor_name}`}
      </p>
      {!compact && (event.event_body || Object.keys(metadata).length > 0) && (
        <span className="mt-1 inline-block text-[10px] text-muted-foreground">
          Open source for details
        </span>
      )}
    </a>
  );
}

export function ProjectTimelinePanel({
  projectId,
  limit = 12,
  compact = false,
}: {
  projectId: string;
  limit?: number;
  compact?: boolean;
}) {
  const [sourceFilter, setSourceFilter] = useState<ProjectTimelineFilters["sourceType"]>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const filters = useMemo<ProjectTimelineFilters>(
    () => ({ sourceType: sourceFilter, signalType: typeFilter }),
    [sourceFilter, typeFilter],
  );
  const { data: timeline = [], isLoading, refetch, isFetching } = useProjectTimelineEvents(projectId, filters);
  const distinctTimeline = useMemo(() => {
    const seen = new Set<string>();
    return timeline.filter((event) => {
      const key = event.source_type === "clickup"
        ? [
            event.related_clickup_task_id ?? event.source_id,
            event.event_type,
            event.source_created_at ?? event.created_at,
            event.event_body ?? "",
          ].join("|")
        : event.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [timeline]);
  const events = distinctTimeline.slice(0, limit);

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
    <div className={compact ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-3"}>
      {!compact && <div className="flex items-start justify-between gap-2">
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
      </div>}

      <div className={`flex flex-wrap gap-1 ${compact ? "shrink-0" : ""}`}>
        {SOURCE_FILTERS.map((filter) => (
          <Button
            key={filter.id ?? "all"}
            size="sm"
            variant={sourceFilter === filter.id ? "secondary" : "outline"}
            className={compact ? "h-7 px-2.5 text-xs" : "h-6 px-2 text-[10px]"}
            onClick={() => setSourceFilter(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {!compact && <div className="flex flex-wrap gap-1">
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
      </div>}

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
        <div className={compact ? "min-h-0 flex-1 overflow-y-auto border-t border-border/70" : "max-h-[420px] overflow-y-auto rounded-lg border border-border bg-card px-3 py-1"}>
          {groups.map(([label, groupEvents]) => (
            <div key={label}>
              <p className={compact ? "pt-3 text-xs font-medium text-muted-foreground" : "sticky top-0 bg-card py-1 section-label text-[10px]"}>
                {label}
              </p>
              {groupEvents.map((event) => (
                <TimelineRow key={event.id} event={event} compact={compact} />
              ))}
            </div>
          ))}
          {distinctTimeline.length > limit && (
            <p className="text-[10px] text-muted-foreground py-2 text-center">
              +{distinctTimeline.length - limit} older event(s)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
