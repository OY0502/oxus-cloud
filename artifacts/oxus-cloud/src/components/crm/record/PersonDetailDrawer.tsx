import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  useCrmPersonAcceptName,
  useCrmPersonCreateNote,
  useCrmPersonDetail,
  useCrmPersonLifecycle,
  useCrmPersonSources,
  useCrmPersonUpdate,
  useCrmPersonActivities,
} from "@/hooks/api";
import type { Contact } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { CrmRecordDrawer } from "./CrmRecordDrawer";
import { CrmPersonHeader, CrmSummaryStrip } from "./CrmPersonHeader";
import { CrmQuickActions, CrmNoteComposer } from "./CrmQuickActions";
import { CrmReviewBanner } from "./CrmReviewBanner";
import { CrmActivityTimeline } from "./CrmActivityTimeline";
import {
  CrmPropertySections,
  draftFromPerson,
  draftToUpdatePayload,
} from "./CrmPropertySections";
import { CrmAssociationsPanel, CrmSourcesPanel } from "./CrmAssociationsPanel";

type PersonDetailDrawerProps = {
  person: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPersonUpdated?: (person: Contact) => void;
};

export function PersonDetailDrawer({
  person,
  open,
  onOpenChange,
  onPersonUpdated,
}: PersonDetailDrawerProps) {
  const personId = person?.id ?? "";
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const detailQuery = useCrmPersonDetail(personId, { enabled: open && !!personId });
  const [tab, setTab] = useState("overview");
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityOffset, setActivityOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [allActivities, setAllActivities] = useState<import("@/hooks/api").CrmPersonActivityItem[]>([]);

  const activitiesQuery = useCrmPersonActivities(personId, {
    enabled: open && !!personId && tab === "activity",
    filter: activityFilter,
    offset: activityOffset,
  });
  const sourcesQuery = useCrmPersonSources(personId, { enabled: open && !!personId && tab === "sources" });

  const updateMutation = useCrmPersonUpdate();
  const acceptNameMutation = useCrmPersonAcceptName();
  const noteMutation = useCrmPersonCreateNote();
  const lifecycleMutation = useCrmPersonLifecycle();

  const detail = detailQuery.data;
  const currentPerson = detail?.person ?? person;

  useEffect(() => {
    if (open && currentPerson) {
      setDraft(draftFromPerson(currentPerson));
      setEditing(false);
      setReviewDismissed(false);
      setTab("overview");
      setActivityOffset(0);
      setAllActivities([]);
    }
  }, [open, personId]);

  useEffect(() => {
    if (activitiesQuery.data?.items) {
      setAllActivities((prev) =>
        activityOffset === 0 ? activitiesQuery.data!.items : [...prev, ...activitiesQuery.data!.items],
      );
    }
  }, [activitiesQuery.data, activityOffset]);

  const showReview = useMemo(() => {
    if (reviewDismissed) return false;
    return detail?.needs_review ?? false;
  }, [detail?.needs_review, reviewDismissed]);

  const handleSave = async () => {
    if (!personId) return;
    try {
      const result = await updateMutation.mutateAsync({
        person_id: personId,
        fields: draftToUpdatePayload(draft),
      });
      onPersonUpdated?.(result.person);
      setEditing(false);
      toast({ title: "Contact updated", description: result.person.display_name ?? result.person.name });
    } catch (e) {
      toast({
        title: "Could not save changes",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleAcceptSuggestion = async () => {
    if (!detail?.name_suggestion || !personId) return;
    try {
      const result = await acceptNameMutation.mutateAsync({
        person_id: personId,
        suggested_name: detail.name_suggestion.suggested_name,
      });
      onPersonUpdated?.(result.person);
      toast({ title: "Name confirmed", description: result.person.display_name ?? result.person.name });
    } catch (e) {
      toast({
        title: "Could not accept suggestion",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  if (!currentPerson) return null;

  const sourcesData = sourcesQuery.data as {
    sources?: Array<{
      source_type: string;
      count: number;
      first_observed: string | null;
      last_observed: string | null;
      evidence_summary: string;
      confidence: number | null;
    }>;
    locked_fields?: string[];
    field_provenance?: Record<string, { source: string; updated_at: string }>;
  } | undefined;

  return (
    <CrmRecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      header={
        <CrmPersonHeader
          person={currentPerson}
          primaryCompany={detail?.primary_company}
          owner={detail?.owner ?? undefined}
        />
      }
      actions={
        <CrmQuickActions
          email={currentPerson.email ?? currentPerson.primary_email}
          editing={editing}
          onEdit={() => {
            if (editing) {
              setEditing(false);
              setDraft(draftFromPerson(currentPerson));
            } else {
              setEditing(true);
              setTab("overview");
            }
          }}
          onEmail={() => {
            const email = currentPerson.email ?? currentPerson.primary_email;
            if (email) window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}`, "_blank");
          }}
          onNote={() => { setNoteOpen(true); setTab("activity"); }}
          onMeeting={() => navigate(`/calendar?compose=1&email=${encodeURIComponent(currentPerson.email ?? "")}`)}
          onTask={() => navigate(`/projects${detail?.projects[0] ? `/${detail.projects[0].id}` : ""}`)}
          onOpenProfile={() => navigate(`/crm/people/${personId}`)}
          onInactive={async () => {
            try {
              await lifecycleMutation.mutateAsync({ person_id: personId, action: "set_inactive" });
              toast({ title: "Marked inactive" });
            } catch (e) {
              toast({ title: "Action failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
            }
          }}
          onSuppress={isSuperAdmin ? async () => {
            try {
              await lifecycleMutation.mutateAsync({ person_id: personId, action: "suppress" });
              toast({ title: "Contact suppressed" });
              onOpenChange(false);
            } catch (e) {
              toast({ title: "Action failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
            }
          } : undefined}
          onDelete={isSuperAdmin ? async () => {
            if (!window.confirm("Delete this contact? This cannot be undone for records without dependencies.")) return;
            try {
              await lifecycleMutation.mutateAsync({ person_id: personId, action: "delete" });
              toast({ title: "Contact deleted" });
              onOpenChange(false);
            } catch (e) {
              toast({ title: "Action failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
            }
          } : undefined}
        />
      }
      summary={
        detail ? (
          <CrmSummaryStrip
            lastInteractionAt={detail.summary.last_interaction_at}
            nextMeetingAt={detail.summary.next_meeting_at}
            meetingCount={detail.summary.meeting_count}
            activeProjects={detail.summary.active_projects}
            openOpportunities={detail.summary.open_opportunities}
          />
        ) : null
      }
      tabs={
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start bg-transparent p-0">
            {["overview", "activity", "associations", "sources"].map((t) => (
              <TabsTrigger key={t} value={t} className="h-8 capitalize data-[state=active]:bg-muted">
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      footer={
        editing ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(draftFromPerson(currentPerson)); }}>
              Cancel
            </Button>
            <Button size="sm" disabled={updateMutation.isPending} onClick={() => void handleSave()}>
              Save changes
            </Button>
          </div>
        ) : undefined
      }
    >
      {showReview && (
        <div className="mb-4">
          <CrmReviewBanner
            email={currentPerson.email ?? currentPerson.primary_email}
            suggestion={detail?.name_suggestion}
            loading={acceptNameMutation.isPending}
            onAccept={() => void handleAcceptSuggestion()}
            onEdit={() => { setEditing(true); setTab("overview"); }}
            onDismiss={() => setReviewDismissed(true)}
            onSuppress={isSuperAdmin ? async () => {
              await lifecycleMutation.mutateAsync({ person_id: personId, action: "suppress" });
              onOpenChange(false);
            } : undefined}
          />
        </div>
      )}

      <CrmNoteComposer
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        saving={noteMutation.isPending}
        onSave={async (body) => {
          await noteMutation.mutateAsync({
            person_id: personId,
            body,
            company_id: detail?.primary_company?.id,
          });
          toast({ title: "Note added" });
        }}
      />

      {tab === "overview" && (
        <CrmPropertySections
          person={currentPerson}
          owner={detail?.owner ?? undefined}
          primaryCompany={detail?.primary_company}
          primaryProject={detail?.projects.find((p) => p.id === currentPerson.primary_project_id) ?? detail?.projects[0]}
          editing={editing}
          draft={draft}
          onDraftChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
          showDataQuality={detail?.needs_review}
        />
      )}

      {tab === "activity" && (
        <CrmActivityTimeline
          items={allActivities}
          filter={activityFilter}
          onFilterChange={(f) => { setActivityFilter(f); setActivityOffset(0); setAllActivities([]); }}
          hasMore={activitiesQuery.data?.has_more}
          loading={activitiesQuery.isLoading}
          onLoadMore={() => setActivityOffset((o) => o + 20)}
        />
      )}

      {tab === "associations" && detail && (
        <CrmAssociationsPanel
          companies={detail.companies}
          projects={detail.projects}
          opportunities={detail.opportunities}
          canEdit
          onSetPrimaryCompany={async (companyId) => {
            try {
              const result = await lifecycleMutation.mutateAsync({
                person_id: personId,
                action: "change_primary_company",
                company_id: companyId,
              });
              if (result && typeof result === "object" && "person" in result) {
                onPersonUpdated?.(result.person as Contact);
              }
              toast({ title: "Primary company updated" });
            } catch (e) {
              toast({ title: "Could not update", description: e instanceof Error ? e.message : "", variant: "destructive" });
            }
          }}
        />
      )}

      {tab === "sources" && (
        <CrmSourcesPanel
          sources={sourcesData?.sources ?? []}
          lockedFields={sourcesData?.locked_fields ?? currentPerson.locked_fields ?? []}
          fieldProvenance={sourcesData?.field_provenance ?? (currentPerson.field_provenance as Record<string, { source: string; updated_at: string }>) ?? {}}
          isAdmin={isSuperAdmin}
          onUnlockField={isSuperAdmin ? async (field) => {
            try {
              await updateMutation.mutateAsync({ person_id: personId, fields: {}, unlock_fields: [field] });
              toast({ title: "Field unlocked" });
            } catch (e) {
              toast({ title: "Could not unlock", description: e instanceof Error ? e.message : "", variant: "destructive" });
            }
          } : undefined}
        />
      )}

      {detailQuery.isLoading && tab === "overview" && (
        <p className="text-sm text-muted-foreground">Loading contact details...</p>
      )}
    </CrmRecordDrawer>
  );
}
