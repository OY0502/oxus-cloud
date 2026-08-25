import React, { useState, useMemo } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, formatDistanceToNow } from "date-fns";
import { AlertTriangle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Loader2, MapPin, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import {
  useCalendarEvents,
  useGoogleConnectionStatus,
  useGoogleCalendarEvents,
  useCalendarAutoRefresh,
  useStartGoogleOAuth,
} from "@/hooks/api";
import { CreateEventDialog } from "@/components/forms/CreateDialogs";
import { ErrorState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarEventWithAttendees } from "@/lib/types";
import { CalendarEventDetailDrawer } from "@/components/calendar/CalendarEventDetailDrawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

function parseEventLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function eventKey(e: { id: string; provider?: string; external_id?: string | null }) {
  return `${e.provider ?? "manual"}:${e.id}`;
}

export function Calendar() {
  const today = new Date();
  const { toast } = useToast();
  const startOAuth = useStartGoogleOAuth();
  const [currentDate, setCurrentDate] = useState(today);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventWithAttendees | null>(null);

  const { data: events = [], isLoading, isError, error, refetch } = useCalendarEvents();
  const googleStatus = useGoogleConnectionStatus({ enabled: true });
  const { data: googleEvents = [], refetch: refetchGoogle } = useGoogleCalendarEvents();
  const { refreshState, refreshError, isSyncing, lastUpdatedAt, retry } = useCalendarAutoRefresh();

  const connected = googleStatus.data?.connected === true;

  const allEvents = useMemo(() => {
    const manual = events as CalendarEventWithAttendees[];
    const googleMapped = googleEvents.map((e) => ({
      ...e,
      attendees: [],
      provider: "google" as const,
    })) as CalendarEventWithAttendees[];
    const seen = new Set<string>();
    const merged: CalendarEventWithAttendees[] = [];
    for (const e of [...manual, ...googleMapped]) {
      const key = e.provider === "google" && e.external_id
        ? `google:${e.external_id}`
        : eventKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
    return merged.sort((a, b) => a.event_date.localeCompare(b.event_date));
  }, [events, googleEvents]);

  const connectGoogle = async () => {
    try {
      const { auth_url } = await startOAuth.mutateAsync({ redirect_after: "/calendar" });
      window.location.href = auth_url;
    } catch (e) {
      toast({
        title: "Could not start Google connection",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToday = () => setCurrentDate(today);

  const openCreate = (date?: Date) => {
    setCreateDate(date ? format(date, "yyyy-MM-dd") : undefined);
    setCreateOpen(true);
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const emptyDays = Array.from({ length: (monthStart.getDay() + 6) % 7 }).map((_, i) => i);

  const eventsOn = (day: Date) =>
    allEvents
      .filter((e) => isSameDay(parseEventLocalDate(e.event_date), day))
      .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

  const agendaEvents = eventsOn(today);
  const maxVisibleEvents = 3;

  return (
    <div className="flex flex-col h-full space-y-6">
      <PageHeader
        title="Calendar"
        subtitle={
          connected && (refreshState === "refreshing" || isSyncing)
            ? "Refreshing calendar…"
            : refreshState === "done"
              ? "Calendar updated"
              : "Schedule and upcoming events."
        }
        breadcrumbs={[{ label: "Workspace" }, { label: "Calendar" }]}
        actions={
          <div className="flex items-center gap-3">
            {connected && lastUpdatedAt && refreshState === "idle" && !isSyncing && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Updated {formatDistanceToNow(new Date(lastUpdatedAt), { addSuffix: true })}
              </span>
            )}
            {connected && refreshState === "refreshing" && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing calendar…
              </span>
            )}
            {connected && refreshState === "error" && (
              <span className="text-xs text-destructive flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                {refreshError ?? "Calendar could not refresh"}
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={retry}>Retry</Button>
              </span>
            )}
            {connected && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Calendar options">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={retry} disabled={isSyncing}>
                    <RefreshCw className="w-4 h-4 mr-2" /> Refresh calendar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button className="gap-2" onClick={() => openCreate(today)}><Plus className="w-4 h-4" /> New Event</Button>
            <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border shadow-soft">
              <Button variant="ghost" onClick={goToday} className="text-sm">Today</Button>
              <div className="h-4 w-px bg-border mx-1"></div>
              <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="text-sm font-medium w-32 text-center">{format(currentDate, "MMMM yyyy")}</span>
              <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        }
      />

      <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} defaultDate={createDate} />
      <CalendarEventDetailDrawer
        event={selectedEvent}
        open={!!selectedEvent}
        onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}
      />

      {isError && <ErrorState error={error} onRetry={() => { void refetch(); void refetchGoogle(); }} />}

      {!connected && !googleStatus.isLoading ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
          <CalendarIcon className="w-10 h-10 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground max-w-md">
            Connect Google Calendar to view and manage your schedule.
          </p>
          <Button className="mt-4" onClick={() => void connectGoogle()} disabled={startOAuth.isPending}>
            Connect Google
          </Button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 flex-1 h-[calc(100vh-12rem)]">
          <div className="flex-1 flex flex-col bg-card rounded-xl border border-border shadow-soft overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border bg-muted/30">
              {weekdayLabels.map((day) => (
                <div key={day} className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">{day}</div>
              ))}
            </div>

            {isLoading ? (
              <div className="flex-1 p-4"><Skeleton className="h-full w-full rounded-lg" /></div>
            ) : (
              <div className="grid grid-cols-7 flex-1 auto-rows-[minmax(100px,_1fr)]">
                {emptyDays.map((day) => (<div key={`empty-${day}`} className="border-r border-b border-border/50 bg-muted/10 p-2"></div>))}

                {days.map((day) => {
                  const isToday = isSameDay(day, today);
                  const dayEvents = eventsOn(day);
                  const visible = dayEvents.slice(0, maxVisibleEvents);
                  const overflow = dayEvents.length - visible.length;
                  return (
                    <div
                      key={day.toISOString()}
                      onClick={() => openCreate(day)}
                      className={cn("border-r border-b border-border/50 p-2 relative group transition-colors cursor-pointer", isToday ? "bg-logo-blue/5" : "hover:bg-muted/30")}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className={cn("text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full z-10 relative", isToday ? "bg-primary text-primary-foreground shadow-md" : "text-foreground group-hover:text-primary transition-colors")}>{format(day, "d")}</span>
                      </div>
                      <div className="flex flex-col gap-1.5 z-10 relative">
                        {visible.map((event) => (
                          <div
                            key={eventKey(event)}
                            onClick={(e) => { e.stopPropagation(); setSelectedEvent(event); }}
                            className="text-xs px-2 py-1 rounded border border-card-border shadow-soft truncate bg-card hover-elevate cursor-pointer flex items-center gap-1.5"
                            style={{ borderLeftColor: event.color ?? "var(--color-chart-1)", borderLeftWidth: "3px" }}
                          >
                            <span className="font-semibold text-muted-foreground truncate w-8">{event.start_time ?? "•"}</span>
                            <span className="truncate font-medium">{event.title}</span>
                            {event.provider === "google" && <span className="sr-only">Google</span>}
                          </div>
                        ))}
                        {overflow > 0 && (
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground text-left px-2 hover:text-primary"
                            onClick={(e) => { e.stopPropagation(); if (dayEvents[maxVisibleEvents]) setSelectedEvent(dayEvents[maxVisibleEvents]); }}
                          >
                            +{overflow} more
                          </button>
                        )}
                      </div>
                      {isToday && <div className="absolute inset-0 border-2 border-primary/20 rounded-sm pointer-events-none"></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="w-full lg:w-96 flex flex-col gap-4">
            <div className="bg-card rounded-xl border border-border shadow-layered flex-1 overflow-hidden flex flex-col paper">
              <div className="p-6 border-b border-border/50 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><CalendarIcon className="w-24 h-24" /></div>
                <h3 className="text-xl font-bold font-serif relative z-10">Today's Agenda</h3>
                <p className="text-muted-foreground mt-1 relative z-10">{format(today, "EEEE, MMMM do, yyyy")}</p>
              </div>

              <div className="p-4 flex-1 overflow-y-auto">
                {agendaEvents.length > 0 ? (
                  <div className="space-y-4">
                    {agendaEvents.map((event, i) => (
                      <div key={eventKey(event)} className="relative flex gap-4">
                        <div className="absolute left-[11px] top-6 bottom-[-16px] w-px bg-border">{i === agendaEvents.length - 1 && <div className="absolute inset-0 bg-card w-full"></div>}</div>
                        <div className="w-6 h-6 rounded-full border-[3px] border-card z-10 mt-1 shrink-0" style={{ backgroundColor: event.color ?? "var(--color-chart-1)" }}></div>
                        <button
                          type="button"
                          className="flex-1 bg-background/50 border border-border/50 rounded-lg p-4 hover:shadow-soft transition-all hover:bg-card hover:border-border text-left"
                          onClick={() => setSelectedEvent(event)}
                        >
                          <div className="flex justify-between items-start mb-2"><h4 className="font-semibold text-foreground leading-tight">{event.title}</h4></div>
                          <div className="flex flex-col gap-2 text-sm text-muted-foreground mt-3">
                            <div className="flex items-center gap-2"><Clock className="w-4 h-4 shrink-0" /><span>{event.start_time ?? "All day"}{event.end_time ? ` - ${event.end_time}` : ""}</span></div>
                            {event.location && (
                              <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 shrink-0" /><span className="truncate">{event.location}</span>
                              </div>
                            )}
                          </div>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No events scheduled for today.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
