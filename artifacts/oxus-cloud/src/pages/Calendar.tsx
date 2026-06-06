import React, { useState } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date("2026-06-15")); // Mocking today as June 15, 2026

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToday = () => setCurrentDate(new Date("2026-06-15"));

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Padding for the start of the week
  const startDay = monthStart.getDay();
  const emptyDays = Array.from({ length: startDay }).map((_, i) => i);

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Calendar</h2>
          <p className="text-muted-foreground text-sm">Schedule and upcoming events.</p>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={goToday}>Today</Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-lg font-medium w-40 text-center">{format(currentDate, "MMMM yyyy")}</span>
            <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border flex-1 flex flex-col overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-muted/50">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="p-3 text-center text-sm font-medium text-muted-foreground">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 auto-rows-fr">
          {emptyDays.map(day => (
            <div key={`empty-${day}`} className="border-r border-b border-border bg-muted/10 p-2"></div>
          ))}
          {days.map(day => {
            const isToday = isSameDay(day, new Date("2026-06-15"));
            return (
              <div 
                key={day.toISOString()} 
                className={`border-r border-b border-border p-2 min-h-[100px] flex flex-col gap-1 transition-colors hover:bg-muted/30 ${isToday ? 'bg-chart-4/10' : ''}`}
              >
                <span className={`text-sm font-medium self-end w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'}`}>
                  {format(day, "d")}
                </span>
                
                {/* Mock Event Data */}
                {isToday && (
                  <div className="bg-chart-1/20 border border-chart-1/50 text-chart-1 rounded px-2 py-1 text-xs truncate">
                    Design Review
                  </div>
                )}
                {day.getDate() === 20 && (
                  <div className="bg-chart-2/20 border border-chart-2/50 text-chart-2 rounded px-2 py-1 text-xs truncate">
                    Client Call
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
