import React, { useState } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, MapPin, Video, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { AvatarStack } from "@/components/AvatarStack";
import { cn } from "@/lib/utils";

// Mock Data for the Calendar
const MOCK_TODAY = new Date("2026-06-15");

const mockEvents = [
  { id: "e1", title: "Project Kickoff: Atlas Fintech", date: "2026-06-15", startTime: "10:00", endTime: "11:30", type: "meeting", attendees: ["https://i.pravatar.cc/150?u=11", "https://i.pravatar.cc/150?u=12", "https://i.pravatar.cc/150?u=15"], location: "Google Meet", color: "var(--color-chart-1)" },
  { id: "e2", title: "Design Sync: Globex", date: "2026-06-15", startTime: "13:00", endTime: "14:00", type: "design", attendees: ["https://i.pravatar.cc/150?u=33", "https://i.pravatar.cc/150?u=14"], location: "Figma / Zoom", color: "var(--color-chart-2)" },
  { id: "e3", title: "Review Pulse Robotics Scope", date: "2026-06-15", startTime: "15:30", endTime: "16:00", type: "internal", attendees: ["https://i.pravatar.cc/150?u=32"], location: "Office Room B", color: "var(--color-chart-3)" },
  
  { id: "e4", title: "Client Presentation", date: "2026-06-18", startTime: "14:00", endTime: "15:00", type: "meeting", attendees: ["https://i.pravatar.cc/150?u=31", "https://i.pravatar.cc/150?u=21"], location: "Zoom", color: "var(--color-chart-1)" },
  { id: "e5", title: "Sprint Planning", date: "2026-06-08", startTime: "09:30", endTime: "11:00", type: "internal", attendees: ["https://i.pravatar.cc/150?u=31", "https://i.pravatar.cc/150?u=32", "https://i.pravatar.cc/150?u=33", "https://i.pravatar.cc/150?u=34"], location: "Main Boardroom", color: "var(--color-chart-3)" },
  { id: "e6", title: "Marketing Review", date: "2026-06-22", startTime: "11:00", endTime: "12:00", type: "meeting", attendees: ["https://i.pravatar.cc/150?u=16"], location: "Google Meet", color: "var(--color-chart-4)" },
  { id: "e7", title: "Website Launch: Verdant Farms", date: "2026-06-25", startTime: "08:00", endTime: "18:00", type: "milestone", attendees: [], location: "", color: "var(--color-chart-5)" },
];

export function Calendar() {
  const [currentDate, setCurrentDate] = useState(MOCK_TODAY);

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToday = () => setCurrentDate(MOCK_TODAY);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Padding for the start of the week
  const startDay = monthStart.getDay();
  const emptyDays = Array.from({ length: startDay }).map((_, i) => i);

  // Agenda Day (defaults to MOCK_TODAY)
  const agendaEvents = mockEvents
    .filter(e => isSameDay(new Date(e.date), MOCK_TODAY))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="flex flex-col h-full space-y-6">
      <PageHeader 
        title="Calendar" 
        subtitle="Schedule and upcoming events."
        breadcrumbs={[{ label: "Workspace" }, { label: "Calendar" }]}
        actions={
          <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-border shadow-soft">
            <Button variant="ghost" onClick={goToday} className="text-sm">Today</Button>
            <div className="h-4 w-px bg-border mx-1"></div>
            <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm font-medium w-32 text-center">{format(currentDate, "MMMM yyyy")}</span>
            <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row gap-6 flex-1 h-[calc(100vh-12rem)]">
        {/* Month View Grid */}
        <div className="flex-1 flex flex-col bg-card rounded-xl border border-border shadow-soft overflow-hidden">
          {/* Days of Week Header */}
          <div className="grid grid-cols-7 border-b border-border bg-muted/30">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 flex-1 auto-rows-[minmax(100px,_1fr)]">
            {emptyDays.map(day => (
              <div key={`empty-${day}`} className="border-r border-b border-border/50 bg-muted/10 p-2"></div>
            ))}
            
            {days.map(day => {
              const isMockToday = isSameDay(day, MOCK_TODAY);
              const dayEvents = mockEvents.filter(e => isSameDay(new Date(e.date), day));
              
              return (
                <div 
                  key={day.toISOString()} 
                  className={cn(
                    "border-r border-b border-border/50 p-2 relative group transition-colors",
                    isMockToday ? "bg-logo-blue/5" : "hover:bg-muted/30"
                  )}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span 
                      className={cn(
                        "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full z-10 relative",
                        isMockToday 
                          ? "bg-primary text-primary-foreground shadow-md" 
                          : "text-foreground group-hover:text-primary transition-colors"
                      )}
                    >
                      {format(day, "d")}
                    </span>
                  </div>
                  
                  <div className="flex flex-col gap-1.5 z-10 relative">
                    {dayEvents.map(event => (
                      <div 
                        key={event.id}
                        className="text-xs px-2 py-1 rounded border shadow-sm truncate bg-card hover-elevate cursor-pointer flex items-center gap-1.5"
                        style={{ borderLeftColor: event.color, borderLeftWidth: '3px' }}
                      >
                        <span className="font-semibold text-muted-foreground truncate w-8">{event.startTime}</span>
                        <span className="truncate font-medium">{event.title}</span>
                      </div>
                    ))}
                  </div>

                  {/* Subtle Background decoration for today */}
                  {isMockToday && (
                    <div className="absolute inset-0 border-2 border-primary/20 rounded-sm pointer-events-none"></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Agenda Panel */}
        <div className="w-full lg:w-96 flex flex-col gap-4">
          <div className="bg-card rounded-xl border border-border shadow-layered flex-1 overflow-hidden flex flex-col paper">
            <div className="p-6 border-b border-border/50 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <CalendarIcon className="w-24 h-24" />
              </div>
              <h3 className="text-xl font-bold font-serif relative z-10">Today's Agenda</h3>
              <p className="text-muted-foreground mt-1 relative z-10">
                {format(MOCK_TODAY, "EEEE, MMMM do, yyyy")}
              </p>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
              {agendaEvents.length > 0 ? (
                <div className="space-y-4">
                  {agendaEvents.map((event, i) => (
                    <div key={event.id} className="relative flex gap-4">
                      {/* Timeline Line */}
                      <div className="absolute left-[11px] top-6 bottom-[-16px] w-px bg-border">
                        {i === agendaEvents.length - 1 && <div className="absolute inset-0 bg-card w-full"></div>}
                      </div>
                      
                      {/* Timeline Dot */}
                      <div 
                        className="w-6 h-6 rounded-full border-[3px] border-card z-10 mt-1 shrink-0"
                        style={{ backgroundColor: event.color }}
                      ></div>
                      
                      {/* Event Card */}
                      <div className="flex-1 bg-background/50 border border-border/50 rounded-lg p-4 hover:shadow-soft transition-all hover:bg-card hover:border-border">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-semibold text-foreground leading-tight">{event.title}</h4>
                        </div>
                        
                        <div className="flex flex-col gap-2 text-sm text-muted-foreground mt-3">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 shrink-0" />
                            <span>{event.startTime} - {event.endTime}</span>
                          </div>
                          
                          {event.location && (
                            <div className="flex items-center gap-2">
                              {event.location.includes("Meet") || event.location.includes("Zoom") ? (
                                <Video className="w-4 h-4 shrink-0" />
                              ) : (
                                <MapPin className="w-4 h-4 shrink-0" />
                              )}
                              <span className="truncate">{event.location}</span>
                            </div>
                          )}
                          
                          {event.attendees && event.attendees.length > 0 && (
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                              <User className="w-4 h-4 shrink-0" />
                              <AvatarStack urls={event.attendees} size="sm" max={3} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <CalendarIcon className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                  <h4 className="font-medium text-lg text-foreground">No events today</h4>
                  <p className="text-sm text-muted-foreground mt-2 max-w-[200px]">
                    Your schedule is clear. Take a break or focus on deep work.
                  </p>
                  <Button variant="outline" className="mt-6" size="sm">
                    Schedule Event
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
