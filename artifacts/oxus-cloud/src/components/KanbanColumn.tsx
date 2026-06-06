import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
  column: {
    id: string;
    title: string;
    description?: string;
  };
  items: any[];
  children: React.ReactNode;
}

export function KanbanColumn({ column, items, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const totalValue = items.reduce((sum, i) => sum + (i.budget || 0), 0);

  return (
    <div className="flex-none w-80 flex flex-col h-full bg-muted/20 rounded-xl border border-border/50 overflow-hidden">
      <div className="p-4 border-b border-border/50 bg-muted/30">
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
            {column.title}
            <Badge variant="secondary" className="bg-background/80 text-muted-foreground rounded-full px-1.5 min-w-5 justify-center">
              {items.length}
            </Badge>
          </h3>
          <button className="text-muted-foreground hover:text-foreground hover:bg-muted p-1 rounded transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex justify-between items-center mt-2">
          <span className="text-xs text-muted-foreground">{column.description}</span>
          <span className="text-sm font-semibold text-primary">${totalValue.toLocaleString()}</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 overflow-y-auto p-3 transition-colors",
          isOver && "bg-primary/5 ring-1 ring-inset ring-primary/20 rounded-b-xl"
        )}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </div>
    </div>
  );
}
