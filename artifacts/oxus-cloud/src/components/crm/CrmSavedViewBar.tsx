import React from "react";
import { cn } from "@/lib/utils";
import type { CrmSavedView } from "@/lib/crm/savedViews";

type Props = {
  views: CrmSavedView[];
  activeViewId: string;
  onViewChange: (viewId: string) => void;
};

export function CrmSavedViewBar({ views, activeViewId, onViewChange }: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          onClick={() => onViewChange(view.id)}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
            activeViewId === view.id
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
