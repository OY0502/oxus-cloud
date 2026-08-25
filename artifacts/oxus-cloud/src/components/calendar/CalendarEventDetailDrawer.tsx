import React from "react";
import { ExternalLink, MapPin, Users, Video } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CalendarEventWithAttendees } from "@/lib/types";

type CalendarEventDetailDrawerProps = {
  event: CalendarEventWithAttendees | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CalendarEventDetailDrawer({ event, open, onOpenChange }: CalendarEventDetailDrawerProps) {
  if (!event) return null;

  const isGoogle = event.provider === "google";
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  const attendeeEmails = (event as { attendee_emails?: string[] }).attendee_emails ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8">{event.title}</SheetTitle>
          <SheetDescription>
            {event.event_date}
            {event.start_time ? ` · ${event.start_time}${event.end_time ? ` – ${event.end_time}` : ""}` : " · All day"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4 text-sm">
          {isGoogle && (
            <Badge variant="outline" className="text-xs">Google Calendar</Badge>
          )}

          {event.location && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{event.location}</span>
            </div>
          )}

          {(event as { organizer_email?: string }).organizer_email && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Organizer</p>
              <p>{(event as { organizer_email?: string }).organizer_email}</p>
            </div>
          )}

          {(attendeeEmails.length > 0 || event.attendees.length > 0) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> Attendees
              </p>
              <ul className="space-y-1">
                {attendeeEmails.map((email) => (
                  <li key={email} className="text-muted-foreground">{email}</li>
                ))}
                {event.attendees.map((a) => (
                  <li key={a.id}>{a.full_name ?? a.email ?? "Attendee"}</li>
                ))}
              </ul>
            </div>
          )}

          {(event as { meeting_url?: string }).meeting_url && (
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-muted-foreground" />
              <a
                href={(event as { meeting_url?: string }).meeting_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate"
              >
                Join Google Meet
              </a>
            </div>
          )}

          {(event as { ai_summary?: string }).ai_summary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Relationship summary</p>
              <p className="text-muted-foreground">{(event as { ai_summary?: string }).ai_summary}</p>
            </div>
          )}

          {(event as { html_link?: string }).html_link && (
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <a href={(event as { html_link?: string }).html_link!} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" /> Open in Google Calendar
              </a>
            </Button>
          )}

          {meta.calendar_id ? (
            <p className="text-[11px] text-muted-foreground font-mono truncate">Calendar: {String(meta.calendar_id)}</p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
