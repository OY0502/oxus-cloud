import React from "react";
import { formatDistanceToNow } from "date-fns";
import { useContactActivities } from "@/hooks/api";
import { StatusBadge } from "@/components/StatusBadge";
import type { Contact } from "@/lib/types";

export function TeamMemberActivity({ person }: { person: Contact }) {
  const { data: activities = [], isLoading } = useContactActivities(person.id);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading activity…</p>;

  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Activity</h3>
      <ul className="space-y-2">
        {activities.map((a) => (
          <li key={a.id} className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2.5 text-sm">
            <StatusBadge status={a.kind} variant="neutral" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.title}</p>
              {a.description && <p className="text-muted-foreground text-xs mt-0.5">{a.description}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
