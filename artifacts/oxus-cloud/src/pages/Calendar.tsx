import React, { useState } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, MapPin, Video, User, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { AvatarStack } from "@/components/AvatarStack";
import { cn } from "@/lib/utils";
import { useCalendarEvents } from "@/hooks/api";
import { CreateEventDialog } from "@/components/forms/CreateDialogs";
import { ErrorState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarEventWithAttendees } from "@/lib/types";
import { profileAvatarUrl } from "@/lib/profiles";

function attendeeUrls(e: CalendarEventWithAttendees): string[] {
  return e.attendees.map(profileAvatarUrl);
}

export function Calendar() {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(today);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);

  const { data: events = [], isLoading, isError, error, refetch } = useCalendarEvents();

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

  const eventsOn = (day: Date) => events.filter((e) => isSameDay(new Date(e.event_date), day)).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  const agendaEvents = eventsOn(today);

  return (
    <div className="flex flex-col h-full space-y-6">
      <PageHeader
        title="Calendar"
        subtitle="Schedule and upcoming events."
        breadcrumbs={[{ label: "Workspace" }, { label: "Calendar" }]}
        actions={
          <div className="flex items-center gap-3">
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

      {isError && <ErrorState error={error} onRetry={() => refetch()} />}

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
                      {dayEvents.map((event) => (
                        <div key={event.id} onClick={(e) => e.stopPropagation()} className="text-xs px-2 py-1 rounded border shadow-sm truncate bg-card hover-elevate cursor-pointer flex items-center gap-1.5" style={{ borderLeftColor: event.color ?? "var(--color-chart-1)", borderLeftWidth: "3px" }}>
                          <span className="font-semibold text-muted-foreground truncate w-8">{event.start_time}</span>
                          <span className="truncate font-medium">{event.title}</span>
                        </div>
                      ))}
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
                    <div key={event.id} className="relative flex gap-4">
                      <div className="absolute left-[11px] top-6 bottom-[-16px] w-px bg-border">{i === agendaEvents.length - 1 && <div className="absolute inset-0 bg-card w-full"></div>}</div>
                      <div className="w-6 h-6 rounded-full border-[3px] border-card z-10 mt-1 shrink-0" style={{ backgroundColor: event.color ?? "var(--color-chart-1)" }}></div>
                      <div className="flex-1 bg-background/50 border border-border/50 rounded-lg p-4 hover:shadow-soft transition-all hover:bg-card hover:border-border">
                        <div className="flex justify-between items-start mb-2"><h4 className="font-semibold text-foreground leading-tight">{event.title}</h4></div>
                        <div className="flex flex-col gap-2 text-sm text-muted-foreground mt-3">
                          <div className="flex items-center gap-2"><Clock className="w-4 h-4 shrink-0" /><span>{event.start_time} - {event.end_time}</span></div>
                          {event.location && (
                            <div className="flex items-center gap-2">
                              {event.location.includes("Meet") || event.location.includes("Zoom") ? <Video className="w-4 h-4 shrink-0" /> : <MapPin className="w-4 h-4 shrink-0" />}
                              <span className="truncate">{event.location}</span>
                            </div>
                          )}
                          {event.attendees.length > 0 && (
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50"><User className="w-4 h-4 shrink-0" /><AvatarStack urls={attendeeUrls(event)} size="sm" max={3} /></div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4"><CalendarIcon className="w-8 h-8 text-muted-foreground/50" /></div>
                  <h4 className="font-medium text-lg text-foreground">No events today</h4>
                  <p className="text-sm text-muted-foreground mt-2 max-w-[200px]">Your schedule is clear. Take a break or focus on deep work.</p>
                  <Button variant="outline" className="mt-6" size="sm" onClick={() => openCreate(today)}>Schedule Event</Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
