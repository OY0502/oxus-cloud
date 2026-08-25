import React from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import type { Contact, Client, Profile } from "@/lib/types";
import { getPersonDisplayState, formatRelationshipLabel } from "@/lib/crm/personRecordDisplay";
import { personInitials } from "@/lib/team";

type CrmPersonHeaderProps = {
  person: Contact;
  primaryCompany?: Client | null;
  owner?: Profile | null;
};

export function CrmPersonHeader({ person, primaryCompany, owner }: CrmPersonHeaderProps) {
  const display = getPersonDisplayState({
    ...person,
    company: primaryCompany?.name ?? person.company,
  });

  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-11 w-11 shrink-0 border">
        {person.avatar_url ? <AvatarImage src={person.avatar_url} alt={display.title} /> : null}
        <AvatarFallback className="text-sm font-medium">
          {personInitials(person.display_name ?? person.name ?? person.email ?? "?")}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-lg font-semibold leading-tight text-foreground">
            {display.title}
          </h2>
          {display.qualityBadge && (
            <Badge variant="outline" className="text-[10px] font-normal text-amber-700 border-amber-300 bg-amber-50">
              {display.qualityBadge}
            </Badge>
          )}
        </div>
        {display.subtitle && (
          <p className="text-sm text-muted-foreground">{display.subtitle}</p>
        )}
        {display.emailLine && (
          <p className="text-sm text-foreground/80">{display.emailLine}</p>
        )}
        {display.warning && (
          <p className="text-xs text-amber-700">{display.warning}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {person.relationship_type && (
            <StatusBadge status={formatRelationshipLabel(person.relationship_type)} variant="neutral" />
          )}
          {owner?.full_name && (
            <span className="text-xs text-muted-foreground">Owner: {owner.full_name}</span>
          )}
          <span className="text-xs text-muted-foreground">{display.sourceSummary}</span>
        </div>
      </div>
    </div>
  );
}

type CrmSummaryStripProps = {
  lastInteractionAt?: string | null;
  nextMeetingAt?: string | null;
  meetingCount?: number;
  activeProjects?: number;
  openOpportunities?: number;
};

export function CrmSummaryStrip({
  lastInteractionAt,
  nextMeetingAt,
  meetingCount = 0,
  activeProjects = 0,
  openOpportunities = 0,
}: CrmSummaryStripProps) {
  const now = Date.now();
  const safeLast = lastInteractionAt && new Date(lastInteractionAt).getTime() <= now
    ? lastInteractionAt
    : null;

  const items = [
    {
      label: "Last interaction",
      value: safeLast
        ? formatDistanceToNow(new Date(safeLast), { addSuffix: true })
        : "No interactions yet",
    },
    {
      label: "Next meeting",
      value: nextMeetingAt
        ? format(new Date(nextMeetingAt), "MMM d, yyyy")
        : "No upcoming meeting",
    },
    { label: "Meetings", value: String(meetingCount) },
    { label: "Active projects", value: String(activeProjects) },
    { label: "Open opportunities", value: String(openOpportunities) },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</div>
          <div className="truncate text-sm font-medium">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
