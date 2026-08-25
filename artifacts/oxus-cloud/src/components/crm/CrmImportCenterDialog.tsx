import React, { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToastAction } from "@/components/ui/toast";
import {
  useAcceptCrmCandidate,
  useCrmImportCandidates,
  useIgnoreCrmCandidate,
  useGoogleWorkspaceSync,
} from "@/hooks/api";
import { GOOGLE_SYNC_STAGE_LABELS, formatSyncProgressDetail } from "@/lib/googleSync";
import { useToast } from "@/hooks/use-toast";
import type { CrmEntityCandidate } from "@/lib/types";
import { EmptyState, ErrorState } from "@/components/states/QueryStates";
import {
  candidateTypeLabel,
  classifyReviewCandidateType,
  reviewActionsFor,
  reviewIdentityFor,
  type CrmReviewAction,
} from "@/lib/crm/reviewQueue";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type AcceptResult = {
  success?: boolean;
  entity_id?: string | null;
  entity_type?: string | null;
  decision?: string;
  created?: boolean;
  matched?: boolean;
  display_name?: string | null;
  visibility?: string | null;
  warning?: string | null;
  company_name?: string | null;
};

function recordSubtitle(c: CrmEntityCandidate): string {
  if (c.entity_type === "company") {
    return c.domain ?? c.website ?? c.company_name ?? "";
  }
  return c.email ?? c.company_name ?? "";
}

function ReviewRow({
  candidate,
  busyId,
  onAction,
}: {
  candidate: CrmEntityCandidate;
  busyId: string | null;
  onAction: (action: CrmReviewAction) => void;
}) {
  const identity = reviewIdentityFor(candidate);
  const busy = busyId === identity;
  const subtitle = recordSubtitle(candidate);
  const reason = candidate.review_reason ?? candidate.reason ?? "Needs confirmation";
  const sources = (candidate.sources ?? []).slice(0, 3);
  const confidence = Math.round((candidate.confidence ?? 0) * 100);
  const candidateType = classifyReviewCandidateType(candidate);
  const actions = reviewActionsFor(candidate);

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{candidate.display_name}</p>
          <Badge variant="secondary" className="shrink-0 font-normal">
            {candidateTypeLabel(candidateType)}
          </Badge>
        </div>
        {subtitle ? (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
        <p className="text-sm leading-snug text-muted-foreground">{reason}</p>
        <p className="text-xs text-muted-foreground/80">
          {confidence}% confidence
          {sources.length > 0 ? ` · ${sources.join(" · ")}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 self-stretch sm:self-center">
        {busy ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" /> Working…
          </span>
        ) : (
          <>
            <Button
              size="sm"
              className="min-w-[5.5rem]"
              onClick={() => onAction(actions.primary.action)}
              disabled={busyId !== null}
            >
              {actions.primary.label}
            </Button>
            {actions.secondary.map((secondary) => (
              <Button
                key={secondary.action}
                size="sm"
                variant={secondary.variant ?? "outline"}
                className="min-w-[5.5rem]"
                onClick={() => onAction(secondary.action)}
                disabled={busyId !== null}
              >
                {secondary.label}
              </Button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function CrmImportCenterDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("people");
  const [busyId, setBusyId] = useState<string | null>(null);
  const candidatesQuery = useCrmImportCandidates({ enabled: open });
  const { syncStatus, isSyncing } = useGoogleWorkspaceSync();
  const accept = useAcceptCrmCandidate();
  const ignore = useIgnoreCrmCandidate();

  const candidates = candidatesQuery.data?.candidates ?? [];
  const counts = candidatesQuery.data?.counts;

  const grouped = useMemo(() => ({
    companies: candidates.filter((c) => c.entity_type === "company"),
    people: candidates.filter((c) => c.entity_type === "person"),
    leads: candidates.filter((c) => c.entity_type === "lead"),
  }), [candidates]);

  const showAcceptToast = (candidate: CrmEntityCandidate, result: AcceptResult) => {
    const name = result.display_name ?? candidate.display_name;
    const personId = result.entity_type === "person" ? result.entity_id : null;
    const created = !!result.created;
    const matched = !!result.matched || result.decision === "matched_existing_person";

    if (result.decision === "linked_as_company_inbox") {
      toast({
        title: "Kept as company inbox",
        description: result.company_name
          ? `${name} linked to ${result.company_name}.`
          : `${name} will not appear as a contact.`,
      });
      return;
    }
    if (result.decision === "suppressed") {
      toast({ title: "Sender suppressed", description: `${name} will not return from unchanged evidence.` });
      return;
    }

    const title = created ? "Contact added to CRM" : matched ? "Matched to existing contact" : "Contact confirmed";
    const description = result.warning
      ? `${name}. ${result.warning}`
      : name;

    toast({
      title,
      description,
      action: personId ? (
        <ToastAction
          altText="View contact"
          onClick={() => {
            onOpenChange(false);
            navigate(`/crm/people/${personId}`);
          }}
        >
          View contact
        </ToastAction>
      ) : undefined,
    });
  };

  const handleAction = async (candidate: CrmEntityCandidate, action: CrmReviewAction) => {
    const identity = reviewIdentityFor(candidate);
    setBusyId(identity);
    try {
      if (action === "ignore") {
        await ignore.mutateAsync({ review_identity: identity, candidate_id: candidate.id });
        toast({ title: "Ignored", description: "Removed from review queue." });
        return;
      }
      const result = await accept.mutateAsync({
        review_identity: identity,
        candidate_id: candidate.id,
        action,
      }) as AcceptResult;
      showAcceptToast(candidate, result);
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Could not update review item. It remains in the queue.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const renderTab = (rows: CrmEntityCandidate[]) => {
    if (candidatesQuery.isError) {
      return <ErrorState error={candidatesQuery.error} onRetry={() => void candidatesQuery.refetch()} />;
    }
    if (candidatesQuery.isLoading) {
      return (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading review queue…
        </div>
      );
    }
    if (rows.length === 0) {
      return <EmptyState title="Nothing needs review" description="All catch-up records are resolved." />;
    }
    return (
      <ScrollArea className="h-[min(56vh,520px)] pr-3">
        <div className="divide-y-0">
          {rows.map((row) => (
            <ReviewRow
              key={reviewIdentityFor(row)}
              candidate={row}
              busyId={busyId}
              onAction={(action) => void handleAction(row, action)}
            />
          ))}
        </div>
      </ScrollArea>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-5 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="space-y-1.5 pr-6 text-left">
          <DialogTitle>Review workspace</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Confirm Google-derived suggestions and CRM records that still need a decision.
            {isSyncing && (
              <span className="mt-2 flex items-center gap-2 text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {GOOGLE_SYNC_STAGE_LABELS[syncStatus.stage]}
                {formatSyncProgressDetail(syncStatus) ? ` · ${formatSyncProgressDetail(syncStatus)}` : ""}
              </span>
            )}
            {!isSyncing && candidates.length > 0 && (
              <> Updated {formatDistanceToNow(new Date(), { addSuffix: true })}.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="people">People ({counts?.people ?? grouped.people.length})</TabsTrigger>
            <TabsTrigger value="companies">Companies ({counts?.companies ?? grouped.companies.length})</TabsTrigger>
            <TabsTrigger value="leads">Leads ({counts?.leads ?? grouped.leads.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="people" className="mt-3 focus-visible:ring-0">
            {renderTab(grouped.people)}
          </TabsContent>
          <TabsContent value="companies" className="mt-3 focus-visible:ring-0">
            {renderTab(grouped.companies)}
          </TabsContent>
          <TabsContent value="leads" className="mt-3 focus-visible:ring-0">
            {renderTab(grouped.leads)}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
