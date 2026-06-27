import React from "react";
import { useLocation } from "wouter";
import { EntityDrawer } from "@/components/EntityDrawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Maximize2, Trophy } from "lucide-react";
import { formatEUR } from "@/lib/currency";
import { profileDisplayName } from "@/lib/profiles";
import { CommentsPanel, TasksPanel, AttachmentsPanel } from "@/components/collab/CollabPanels";
import type { QuoteWithRefs } from "@/lib/types";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
      <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1 block">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

interface QuoteDrawerProps {
  quote: QuoteWithRefs | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkWon?: (quote: QuoteWithRefs) => void;
}

export function QuoteDrawer({ quote, open, onOpenChange, onMarkWon }: QuoteDrawerProps) {
  const [, navigate] = useLocation();

  return (
    <EntityDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={quote?.number || quote?.company || "Quote"}
      description={quote ? `${quote.organization?.name ?? quote.company} · ${formatEUR(quote.budget)}` : undefined}
      headerActions={
        quote && (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate(`/quotes/${quote.id}`)}>
            <Maximize2 className="w-4 h-4" /> Open full page
          </Button>
        )
      }
    >
      {quote && (
        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/50">
            <div className="flex items-center gap-3">
              <StatusBadge status={quote.stage.replace("-", " ")} />
              <span className="text-sm text-muted-foreground capitalize">{quote.urgency} priority</span>
            </div>
            <div className="text-2xl font-bold font-sans">{formatEUR(quote.budget)}</div>
          </div>

          <Tabs defaultValue="details">
            <TabsList className="bg-muted/50 p-1 border border-border w-full justify-start">
              <TabsTrigger value="details" className="data-[state=active]:bg-card data-[state=active]:shadow-sm">Details</TabsTrigger>
              <TabsTrigger value="comments" className="data-[state=active]:bg-card data-[state=active]:shadow-sm">Comments</TabsTrigger>
              <TabsTrigger value="tasks" className="data-[state=active]:bg-card data-[state=active]:shadow-sm">Tasks</TabsTrigger>
              <TabsTrigger value="files" className="data-[state=active]:bg-card data-[state=active]:shadow-sm">Attachments</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="mt-4 space-y-6 outline-none">
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Organization" value={quote.organization?.name ?? quote.company ?? "—"} />
                <Detail label="Point of Contact" value={quote.point_of_contact?.name ?? quote.contact_name ?? "—"} />
                <Detail label="Project Type" value={quote.project_type ?? "—"} />
                <Detail label="Technology" value={quote.technology?.name ?? "—"} />
                <Detail label="Assigned To" value={quote.assigned_user ? profileDisplayName(quote.assigned_user) : "Unassigned"} />
                <Detail label="Next Action" value={quote.next_action ?? "—"} />
              </div>

              {quote.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3">Tags</h4>
                  <div className="flex gap-2 flex-wrap">
                    {quote.tags.map((tag) => (<Badge key={tag} variant="secondary">{tag}</Badge>))}
                  </div>
                </div>
              )}

              {quote.stage !== "won" && quote.stage !== "archived" && onMarkWon && (
                <Button className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => onMarkWon(quote)}>
                  <Trophy className="w-4 h-4" /> Mark as Won
                </Button>
              )}
            </TabsContent>

            <TabsContent value="comments" className="mt-4 outline-none">
              <CommentsPanel entityType="quote" entityId={quote.id} />
            </TabsContent>
            <TabsContent value="tasks" className="mt-4 outline-none">
              <TasksPanel entityType="quote" entityId={quote.id} />
            </TabsContent>
            <TabsContent value="files" className="mt-4 outline-none">
              <AttachmentsPanel entityType="quote" entityId={quote.id} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </EntityDrawer>
  );
}
