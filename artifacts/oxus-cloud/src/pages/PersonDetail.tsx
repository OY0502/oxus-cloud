import React, { useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, TableSkeleton } from "@/components/states/QueryStates";
import {
  useContacts,
  useCrmPersonDetail,
  useCrmPersonActivities,
  useCrmPersonSources,
  useCrmPersonUpdate,
  useCrmPersonCreateNote,
} from "@/hooks/api";
import { CrmPersonHeader, CrmSummaryStrip } from "@/components/crm/record/CrmPersonHeader";
import { CrmQuickActions, CrmNoteComposer } from "@/components/crm/record/CrmQuickActions";
import { CrmReviewBanner } from "@/components/crm/record/CrmReviewBanner";
import { CrmActivityTimeline } from "@/components/crm/record/CrmActivityTimeline";
import {
  CrmPropertySections,
  draftFromPerson,
  draftToUpdatePayload,
} from "@/components/crm/record/CrmPropertySections";
import { CrmAssociationsPanel, CrmSourcesPanel } from "@/components/crm/record/CrmAssociationsPanel";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export function PersonDetail() {
  const [, params] = useRoute("/crm/people/:id");
  const personId = params?.id ?? "";
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const contactsQuery = useContacts();
  const detailQuery = useCrmPersonDetail(personId, { enabled: !!personId });
  const [tab, setTab] = useState("overview");
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityOffset, setActivityOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);

  const activitiesQuery = useCrmPersonActivities(personId, {
    enabled: !!personId && tab === "activity",
    filter: activityFilter,
    offset: activityOffset,
  });
  const sourcesQuery = useCrmPersonSources(personId, { enabled: !!personId && tab === "sources" });
  const updateMutation = useCrmPersonUpdate();
  const noteMutation = useCrmPersonCreateNote();

  const person = detailQuery.data?.person ?? contactsQuery.data?.find((c) => c.id === personId);

  React.useEffect(() => {
    if (person) setDraft(draftFromPerson(person));
  }, [person?.id, person?.updated_at]);

  if (contactsQuery.isLoading && !person) return <TableSkeleton rows={6} />;
  if (!person) {
    return <ErrorState error={new Error("Person not found.")} onRetry={() => void detailQuery.refetch()} />;
  }

  const detail = detailQuery.data;
  const showReview = !reviewDismissed && (detail?.needs_review ?? false);

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

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ person_id: personId, fields: draftToUpdatePayload(draft) });
      setEditing(false);
      toast({ title: "Contact updated" });
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/crm?tab=people"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 space-y-4">
          <PageHeader title="Person profile" subtitle="Complete CRM record workspace" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr_300px]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <CrmPersonHeader
            person={person}
            primaryCompany={detail?.primary_company}
            owner={detail?.owner ?? undefined}
          />
          {detail && (
            <CrmSummaryStrip
              lastInteractionAt={detail.summary.last_interaction_at}
              nextMeetingAt={detail.summary.next_meeting_at}
              meetingCount={detail.summary.meeting_count}
              activeProjects={detail.summary.active_projects}
              openOpportunities={detail.summary.open_opportunities}
            />
          )}
          <CrmPropertySections
            person={person}
            owner={detail?.owner ?? undefined}
            primaryCompany={detail?.primary_company}
            editing={editing}
            draft={draft}
            onDraftChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
            showDataQuality={detail?.needs_review}
          />
        </aside>

        <main className="space-y-4 min-w-0">
          <CrmQuickActions
            email={person.email ?? person.primary_email}
            editing={editing}
            onEdit={() => setEditing((e) => !e)}
            onEmail={() => {
              const email = person.email ?? person.primary_email;
              if (email) window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}`, "_blank");
            }}
            onNote={() => setNoteOpen(true)}
            onMeeting={() => { window.location.href = `/calendar?compose=1&email=${encodeURIComponent(person.email ?? "")}`; }}
            onTask={() => { window.location.href = detail?.projects[0] ? `/projects/${detail.projects[0].id}` : "/projects"; }}
          />

          <CrmNoteComposer
            open={noteOpen}
            onClose={() => setNoteOpen(false)}
            saving={noteMutation.isPending}
            onSave={async (body) => {
              await noteMutation.mutateAsync({ person_id: personId, body, company_id: detail?.primary_company?.id });
              toast({ title: "Note added" });
            }}
          />

          {showReview && detail && (
            <CrmReviewBanner
              email={person.email ?? person.primary_email}
              suggestion={detail.name_suggestion}
              onAccept={async () => {
                if (!detail.name_suggestion) return;
                await updateMutation.mutateAsync({
                  person_id: personId,
                  fields: {
                    display_name: detail.name_suggestion.suggested_name,
                    name: detail.name_suggestion.suggested_name,
                    manually_confirmed: true,
                  },
                });
                toast({ title: "Name confirmed" });
              }}
              onEdit={() => setEditing(true)}
              onDismiss={() => setReviewDismissed(true)}
            />
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Activity</TabsTrigger>
              <TabsTrigger value="activity">Timeline</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <p className="text-sm text-muted-foreground mb-3">
                Use the composer above to add notes, email, meetings, or tasks.
              </p>
            </TabsContent>
            <TabsContent value="activity" className="mt-4">
              <CrmActivityTimeline
                items={activitiesQuery.data?.items ?? []}
                filter={activityFilter}
                onFilterChange={(f) => { setActivityFilter(f); setActivityOffset(0); }}
                hasMore={activitiesQuery.data?.has_more}
                loading={activitiesQuery.isLoading}
                onLoadMore={() => setActivityOffset((o) => o + 20)}
              />
            </TabsContent>
          </Tabs>

          {editing && (
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="ghost" onClick={() => { setEditing(false); setDraft(draftFromPerson(person)); }}>Cancel</Button>
              <Button onClick={() => void handleSave()} disabled={updateMutation.isPending}>Save changes</Button>
            </div>
          )}
        </main>

        <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
          {detail && (
            <CrmAssociationsPanel
              companies={detail.companies}
              projects={detail.projects}
              opportunities={detail.opportunities}
            />
          )}
          <CrmSourcesPanel
            sources={sourcesData?.sources ?? []}
            lockedFields={sourcesData?.locked_fields ?? person.locked_fields ?? []}
            fieldProvenance={sourcesData?.field_provenance ?? (person.field_provenance as Record<string, { source: string; updated_at: string }>) ?? {}}
            isAdmin={isSuperAdmin}
            onUnlockField={isSuperAdmin ? async (field) => {
              await updateMutation.mutateAsync({ person_id: personId, fields: {}, unlock_fields: [field] });
              toast({ title: "Field unlocked" });
            } : undefined}
          />
        </aside>
      </div>
    </div>
  );
}
