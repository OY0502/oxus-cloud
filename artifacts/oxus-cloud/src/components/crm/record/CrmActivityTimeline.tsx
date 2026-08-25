import React from "react";
import { format } from "date-fns";
import {
  Activity,
  Calendar,
  FileText,
  ListTodo,
  Mail,
  RefreshCw,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CrmPersonActivityItem } from "@/hooks/api";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  meeting: <Calendar className="h-4 w-4" />,
  note: <FileText className="h-4 w-4" />,
  task: <ListTodo className="h-4 w-4" />,
  business: <Briefcase className="h-4 w-4" />,
};

const FILTERS = ["all", "emails", "meetings", "notes", "tasks", "business"] as const;

type CrmActivityTimelineProps = {
  items: CrmPersonActivityItem[];
  filter: string;
  onFilterChange: (filter: string) => void;
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
};

export function CrmActivityTimeline({
  items,
  filter,
  onFilterChange,
  hasMore,
  loading,
  onLoadMore,
  emptyMessage = "No activity recorded yet. Interactions will appear here after email sync, meetings, or manual notes.",
}: CrmActivityTimelineProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "secondary" : "ghost"}
            className="h-8 capitalize"
            onClick={() => onFilterChange(f)}
          >
            {f === "all" ? "All" : f}
          </Button>
        ))}
      </div>

      {items.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
              <div className="mt-0.5 text-muted-foreground">
                {TYPE_ICONS[item.type] ?? <Activity className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <time className="text-xs text-muted-foreground">
                    {item.occurred_at ? format(new Date(item.occurred_at), "MMM d, yyyy · h:mm a") : "—"}
                  </time>
                </div>
                {item.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground capitalize">{item.source}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <Button variant="outline" size="sm" className="w-full" disabled={loading} onClick={onLoadMore}>
          {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
          Load more
        </Button>
      )}
    </div>
  );
}
