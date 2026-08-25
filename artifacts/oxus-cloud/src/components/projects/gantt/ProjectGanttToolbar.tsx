import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GANTT_SCALE_OPTIONS, type GanttScale } from "@/lib/ganttScale";

interface ProjectGanttToolbarProps {
  scale: GanttScale;
  onScaleChange: (scale: GanttScale) => void;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function ProjectGanttToolbar({
  scale,
  onScaleChange,
  onToday,
  onPrevious,
  onNext,
}: ProjectGanttToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onToday} aria-label="Jump to today">
          Today
        </Button>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={onPrevious} aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={onNext} aria-label="Next period">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground hidden sm:inline">View</span>
        <Select value={scale} onValueChange={(v) => onScaleChange(v as GanttScale)}>
          <SelectTrigger className="h-8 w-[120px]" aria-label="Timeline scale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GANTT_SCALE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
