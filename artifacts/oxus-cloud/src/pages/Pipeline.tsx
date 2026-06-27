import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { DndContext, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, KanbanSquare } from "lucide-react";
import { DealCard, DealCardData } from "@/components/DealCard";
import { KanbanColumn } from "@/components/KanbanColumn";
import { QuoteDrawer } from "@/components/QuoteDrawer";
import { ConvertQuoteDialog } from "@/components/ConvertQuoteDialog";
import { useQuotes, useUpdateQuoteStage } from "@/hooks/api";
import { EmptyState, ErrorState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";
import type { QuoteStage, QuoteWithRefs } from "@/lib/types";

const COLUMNS: { id: QuoteStage; title: string; description: string }[] = [
  { id: "new-lead", title: "New Lead", description: "Recently captured leads" },
  { id: "scoping", title: "Scoping", description: "Defining requirements" },
  { id: "proposal", title: "Proposal", description: "Awaiting client sign-off" },
  { id: "won", title: "Won", description: "Closed quotes" },
  { id: "archived", title: "Archived", description: "No longer active" },
];

function ageInStage(q: QuoteWithRefs): number {
  return Math.max(0, Math.floor((Date.now() - new Date(q.stage_entered_at).getTime()) / 86_400_000));
}

function toCardData(q: QuoteWithRefs): DealCardData {
  const title = q.organization?.name ?? q.company;
  return {
    id: q.id,
    company: title,
    contact: q.point_of_contact?.name ?? q.contact_name ?? "",
    projectType: q.project_type ?? "",
    budget: q.budget,
    pocName: q.point_of_contact?.name ?? q.contact_name ?? "",
    avatarUrl: null,
    ageInStage: ageInStage(q),
    nextAction: q.next_action ?? "",
    tags: q.tags,
    urgency: q.urgency,
  };
}

function SortableItem({ id, quote, onClick, isArchived }: { id: string; quote: QuoteWithRefs; onClick: () => void; isArchived?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={onClick} className={isArchived ? "opacity-50 grayscale" : undefined}>
      <DealCard item={toCardData(quote)} className="cursor-grab active:cursor-grabbing" />
    </div>
  );
}

export function Pipeline() {
  const [, navigate] = useLocation();
  const { data: quotes = [], isLoading, isError, error, refetch } = useQuotes();
  const updateStage = useUpdateQuoteStage();
  const [items, setItems] = useState<QuoteWithRefs[]>([]);
  const [selected, setSelected] = useState<QuoteWithRefs | null>(null);
  const [convertQuote, setConvertQuote] = useState<QuoteWithRefs | null>(null);

  useEffect(() => { setItems(quotes); }, [quotes]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const columnIds = useMemo(() => COLUMNS.map((c) => c.id) as string[], []);

  const handleDragOver = useCallback((event: any) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    setItems((prev) => {
      const resolve = (id: string) => (columnIds.includes(id) ? id : prev.find((i) => i.id === id)?.stage ?? null);
      const sourceCol = resolve(activeId);
      const targetCol = resolve(overId);
      if (!sourceCol || !targetCol || sourceCol === targetCol) return prev;
      return prev.map((item) => (item.id === activeId ? { ...item, stage: targetCol as QuoteStage } : item));
    });
  }, [columnIds]);

  const handleDragEnd = useCallback((event: any) => {
    const { active, over } = event;
    if (!over) return;
    const moved = items.find((i) => i.id === active.id);
    const original = quotes.find((i) => i.id === active.id);
    if (moved && original && moved.stage !== original.stage) {
      updateStage.mutate({ id: moved.id, stage: moved.stage });
      if (moved.stage === "won" && !moved.converted_project_id) {
        setConvertQuote(moved);
      }
    }
    if (active.id === over.id) return;
    setItems((prev) => {
      const activeIdx = prev.findIndex((i) => i.id === active.id);
      const overIdx = prev.findIndex((i) => i.id === over.id);
      if (activeIdx === -1 || overIdx === -1) return prev;
      return arrayMove(prev, activeIdx, overIdx);
    });
  }, [items, quotes, updateStage]);

  const handleMarkWon = (quote: QuoteWithRefs) => {
    updateStage.mutate({ id: quote.id, stage: "won" });
    setSelected(null);
    setConvertQuote(quote);
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col -mx-2 px-2">
      <PageHeader
        title="Pipeline"
        subtitle="Manage quotes through the sales process."
        actions={
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2" onClick={() => navigate("/quotes/new")}>
            <Plus className="w-4 h-4" /> Add Quote
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex-1 flex gap-4 pb-4">
          {COLUMNS.map((c) => (
            <div key={c.id} className="flex-none w-80 space-y-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : quotes.length === 0 ? (
        <EmptyState
          icon={<KanbanSquare />}
          title="Your pipeline is empty"
          description="Add your first quote to start moving leads through to won."
          action={<Button onClick={() => navigate("/quotes/new")}>Add Quote</Button>}
        />
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
          <div className="flex gap-4 h-full min-w-max">
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
              {COLUMNS.map((col) => {
                const colItems = items.filter((item) => item.stage === col.id);
                return (
                  <KanbanColumn key={col.id} column={col} items={colItems}>
                    {colItems.map((item) => (
                      <SortableItem key={item.id} id={item.id} quote={item} onClick={() => setSelected(item)} isArchived={col.id === "archived"} />
                    ))}
                  </KanbanColumn>
                );
              })}
            </DndContext>
          </div>
        </div>
      )}

      <QuoteDrawer
        quote={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        onMarkWon={handleMarkWon}
      />

      <ConvertQuoteDialog
        quote={convertQuote}
        open={!!convertQuote}
        onOpenChange={(o) => !o && setConvertQuote(null)}
        onDone={() => setConvertQuote(null)}
      />
    </div>
  );
}
