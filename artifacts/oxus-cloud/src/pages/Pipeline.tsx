import React, { useState, useCallback, useMemo } from "react";
import { DndContext, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pipelineData } from "@/data/mock";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EntityDrawer } from "@/components/EntityDrawer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";
import { DealCard, DealCardData } from "@/components/DealCard";
import { KanbanColumn } from "@/components/KanbanColumn";

function SortableItem({ id, item, onClick, isArchived }: { id: string; item: DealCardData; onClick: () => void; isArchived?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick} className={isArchived ? "opacity-50 grayscale" : undefined}>
      <DealCard item={item} className="cursor-grab active:cursor-grabbing" />
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

  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);

  const handleDragOver = useCallback((event: any) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    setItems(prev => {
      const resolve = (id: string) => columnIds.includes(id) ? id : prev.find(i => i.id === id)?.columnId ?? null;
      const sourceCol = resolve(activeId);
      const targetCol = resolve(overId);
      if (!sourceCol || !targetCol || sourceCol === targetCol) return prev;
      return prev.map(item => item.id === activeId ? { ...item, columnId: targetCol } : item);
    });
  }, [columnIds]);

  const handleDragEnd = useCallback((event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems(prev => {
      const activeIdx = prev.findIndex(i => i.id === active.id);
      const overIdx = prev.findIndex(i => i.id === over.id);
      if (activeIdx === -1 || overIdx === -1) return prev;
      return arrayMove(prev, activeIdx, overIdx);
    });
  }, []);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col -mx-2 px-2">
      <PageHeader 
        title="Pipeline" 
        subtitle="Manage leads and deals through the sales process."
        actions={
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            Add Deal
          </Button>
        }
      />
      
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex gap-4 h-full min-w-max">
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            {columns.map((col) => {
              const colItems = items.filter((item) => item.columnId === col.id);
              return (
                <KanbanColumn key={col.id} column={col} items={colItems}>
                  {colItems.map((item) => (
                    <SortableItem
                      key={item.id}
                      id={item.id}
                      item={item}
                      onClick={() => setSelectedCard(item)}
                      isArchived={col.id === "archived"}
                    />
                  ))}
                </KanbanColumn>
              );
            })}
          </DndContext>
        </div>
      </div>

      <EntityDrawer 
        open={!!selectedCard} 
        onOpenChange={(open) => !open && setSelectedCard(null)}
        title={selectedCard?.company}
        description={`Lead value: $${selectedCard?.budget?.toLocaleString()}`}
        headerActions={
          <Button variant="outline" size="sm">Edit Deal</Button>
        }
      >
        {selectedCard && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1 block">Project Type</span>
                <span className="text-sm font-medium">{selectedCard.projectType}</span>
              </div>
              <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1 block">Contact</span>
                <span className="text-sm font-medium">{selectedCard.contact}</span>
              </div>
              <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1 block">Age in Stage</span>
                <span className="text-sm font-medium flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {selectedCard.ageInStage} days
                </span>
              </div>
              <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1 block">Next Action</span>
                <span className="text-sm font-medium text-primary">{selectedCard.nextAction}</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Tags</h4>
              <div className="flex gap-2">
                {selectedCard.tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Owner</h4>
              <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl border border-border/50">
                <Avatar className="w-10 h-10 border-2 border-background">
                  <AvatarImage src={selectedCard.ownerAvatar} />
                  <AvatarFallback>U</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium text-foreground">Alex Designer</p>
                  <p className="text-xs text-muted-foreground">Sales Executive</p>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-border/50 flex gap-3">
              <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">
                Convert to Project
              </Button>
              <Button variant="outline" className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30">
                Mark as Lost
              </Button>
            </div>
          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
