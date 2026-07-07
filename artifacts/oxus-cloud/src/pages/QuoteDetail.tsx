import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, Trophy, ExternalLink } from "lucide-react";
import { useQuote, useUpdateQuoteStage } from "@/hooks/api";
import { ConvertQuoteDialog } from "@/components/ConvertQuoteDialog";
import { CommentsPanel, TasksPanel, AttachmentsPanel } from "@/components/collab/CollabPanels";
import { formatEUR } from "@/lib/currency";
import { profileDisplayName } from "@/lib/profiles";
import { ErrorState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
      <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1 block">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function QuoteDetail() {
  const params = useParams();
  const id = params.id as string;
  const [, navigate] = useLocation();
  const { data: quote, isLoading, isError, error, refetch } = useQuote(id);
  const updateStage = useUpdateQuoteStage();
  const [convertOpen, setConvertOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!quote) return <div className="text-muted-foreground">Quote not found.</div>;

  const markWon = () => {
    updateStage.mutate({ id: quote.id, stage: "won" });
    setConvertOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={quote.number || quote.company}
        subtitle={quote.organization?.name ?? quote.company}
        actions={
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2" onClick={() => navigate("/pipeline")}><ArrowLeft className="w-4 h-4" /> Pipeline</Button>
            {quote.stage !== "won" && quote.stage !== "archived" && (
              <Button className="gap-2" onClick={markWon}><Trophy className="w-4 h-4" /> Mark as Won</Button>
            )}
            {quote.converted_project_id && (
              <Button variant="outline" className="gap-2" onClick={() => navigate(`/projects/${quote.converted_project_id}`)}>
                <ExternalLink className="w-4 h-4" /> View Project
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <StatusBadge status={quote.stage.replace("-", " ")} />
                <div className="text-3xl font-bold font-sans">{formatEUR(quote.budget)}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Organization" value={quote.organization?.name ?? quote.company ?? "—"} />
                <Detail label="Point of Contact" value={quote.point_of_contact?.name ?? quote.contact_name ?? "—"} />
                <Detail label="Project Type" value={quote.project_type ?? "—"} />
                <Detail label="Technology" value={quote.technology?.name ?? "—"} />
                <Detail label="Urgency" value={<span className="capitalize">{quote.urgency}</span>} />
                <Detail label="Assigned To" value={quote.assigned_user ? profileDisplayName(quote.assigned_user) : "Unassigned"} />
              </div>
              {quote.next_action && <Detail label="Next Action" value={quote.next_action} />}
              {quote.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {quote.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-4">
              <h3 className="section-label">Comments</h3>
              <CommentsPanel entityType="quote" entityId={quote.id} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <h3 className="section-label">Active Tasks</h3>
              <TasksPanel entityType="quote" entityId={quote.id} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-4">
              <h3 className="section-label">Attachments</h3>
              <AttachmentsPanel entityType="quote" entityId={quote.id} />
            </CardContent>
          </Card>
        </div>
      </div>

      <ConvertQuoteDialog quote={quote} open={convertOpen} onOpenChange={setConvertOpen} />
    </div>
  );
}
