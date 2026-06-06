import React, { useState } from "react";
import { DndContext, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors, useDroppable } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pipelineData } from "@/data/mock";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

function SortableItem({ id, item, onClick }: { id: string, item: any, onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick}>
      <Card className="mb-3 cursor-grab active:cursor-grabbing hover-elevate">
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-medium text-sm">{item.company}</h4>
            <span className="text-xs font-semibold text-chart-2">${item.value.toLocaleString()}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{item.contact}</p>
          <div className="flex justify-between items-center">
            <div className="flex gap-1">
              {item.tags.map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
            <Avatar className="w-6 h-6">
              <AvatarImage src={item.avatar} />
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PipelineColumn({
  column,
  items,
  onCardClick,
}: {
  column: { id: string; title: string };
  items: any[];
  onCardClick: (item: any) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div className="flex-none w-80 bg-muted/30 rounded-lg p-4 flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-sm">{column.title}</h3>
        <Badge variant="outline" className="bg-background">{items.length}</Badge>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded-md transition-colors min-h-24 ${isOver ? "bg-primary/5 ring-2 ring-primary/20" : ""}`}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id} item={item} onClick={() => onCardClick(item)} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

export function Pipeline() {
  const [columns] = useState(pipelineData.columns);
  const [items, setItems] = useState(pipelineData.cards);
  const [selectedCard, setSelectedCard] = useState<any>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const columnIds = columns.map((c) => c.id);

  const resolveColumnId = (id: string) => {
    if (columnIds.includes(id)) return id;
    const card = items.find((item) => item.id === id);
    return card ? card.columnId : null;
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    if (activeId === overId) return;

    const sourceColumn = resolveColumnId(activeId);
    const targetColumn = resolveColumnId(overId);
    if (!sourceColumn || !targetColumn) return;

    setItems((prev) => {
      const activeIndex = prev.findIndex((item) => item.id === activeId);
      if (activeIndex === -1) return prev;

      // Moving across columns: reassign columnId, then position near the drop target.
      if (sourceColumn !== targetColumn) {
        const next = prev.map((item) =>
          item.id === activeId ? { ...item, columnId: targetColumn } : item
        );
        const movedIndex = next.findIndex((item) => item.id === activeId);
        const overIndex = next.findIndex((item) => item.id === overId);
        const insertIndex = overIndex === -1 ? next.length - 1 : overIndex;
        return arrayMove(next, movedIndex, insertIndex);
      }

      // Reordering within the same column.
      const overIndex = prev.findIndex((item) => item.id === overId);
      if (overIndex === -1) return prev;
      return arrayMove(prev, activeIndex, overIndex);
    });
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Pipeline</h2>
          <p className="text-muted-foreground text-sm">Manage your leads and deals.</p>
        </div>
      </div>
      
      <div className="flex-1 flex gap-6 overflow-x-auto pb-4">
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          {columns.map((col) => (
            <PipelineColumn
              key={col.id}
              column={col}
              items={items.filter((item) => item.columnId === col.id)}
              onCardClick={setSelectedCard}
            />
          ))}
        </DndContext>
      </div>

      <Sheet open={!!selectedCard} onOpenChange={() => setSelectedCard(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selectedCard?.company} - Quote Details</SheetTitle>
            <SheetDescription>Lead value: ${selectedCard?.value.toLocaleString()}</SheetDescription>
          </SheetHeader>
          {selectedCard && (
            <div className="mt-6 space-y-4">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Contact</h4>
                <p className="text-base">{selectedCard.contact}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Tags</h4>
                <div className="flex gap-2 mt-1">
                  {selectedCard.tags.map((tag: string) => (
                    <Badge key={tag} className="bg-chart-1 text-white">{tag}</Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
