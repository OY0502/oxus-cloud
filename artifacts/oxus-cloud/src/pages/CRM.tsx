import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { startOfMonth, endOfMonth, isWithinInterval, parseISO, subDays } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Globe, Inbox } from "lucide-react";
import {
  useClients, useContacts, useInvoices, useProjects, useQuotes,
  useGoogleWorkspaceSync, useCrmImportCandidates, useGoogleCalendarEvents,
} from "@/hooks/api";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Client, Contact, Quote } from "@/lib/types";
import { formatEUR } from "@/lib/currency";
import { invoiceTotalEur, invoiceAmountDueEur } from "@/lib/invoiceEur";
import { isOutstandingReceivable } from "@/lib/invoiceClassification";
import { GoogleConnection } from "@/components/crm/GoogleConnection";
import { CrmImportCenterDialog } from "@/components/crm/CrmImportCenterDialog";
import { CompanyDetailDrawer, PersonDetailDrawer } from "@/components/crm/CrmEntityDrawers";
import { CrmAddRecordMenu } from "@/components/crm/CrmAddRecordMenu";
import { CrmKpiStrip } from "@/components/crm/CrmKpiStrip";
import { CrmSavedViewBar } from "@/components/crm/CrmSavedViewBar";
import { CrmQualityBadge } from "@/components/crm/CrmQualityBadge";
import {
  loadLastCrmTab, saveLastCrmTab, getPrimarySavedViewsForTab,
  PEOPLE_SAVED_VIEWS, COMPANY_SAVED_VIEWS, type CrmTab,
} from "@/lib/crm/savedViews";
import { isActiveInDefaultCrmView, isListableInCrm, parseEntitySources, personQualityBadge } from "@/lib/crm/visibility";
import { entityNeedsReview } from "@/lib/crm/reviewQueue";
import { formatLastInteractionAt, formatNextMeetingAt } from "@/lib/crm/interactionDates";

const INTERNAL_EMAIL_SUFFIXES = ["@oxus.agency", "@oxus.cloud"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isExternalAttendeeEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return !INTERNAL_EMAIL_SUFFIXES.some((s) => lower.endsWith(s));
}

/** Base CRM list pool: exclude suppressed/merged/soft-deleted; keep review + inactive for view filters. */
function isInCrmPool(record: {
  visibility_state?: string | null;
  data_quality_status?: string | null;
  is_role_inbox?: boolean;
  soft_deleted_at?: string | null;
}, includeReview = false): boolean {
  if (!isListableInCrm(record)) return false;
  if (includeReview) return true;
  return isActiveInDefaultCrmView(record);
}

export function CRM() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { isSuperAdmin, user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<CrmTab>(() => loadLastCrmTab());
  const [peopleViewId, setPeopleViewId] = useState("all");
  const [companyViewId, setCompanyViewId] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Client | null>(null);
  const [selectedLead, setSelectedLead] = useState<Quote | null>(null);
  const [importCenterOpen, setImportCenterOpen] = useState(false);

  const google = useGoogleWorkspaceSync();
  const candidatesQuery = useCrmImportCandidates({ enabled: isSuperAdmin });
  const calendarQuery = useGoogleCalendarEvents();
  const pendingReviewCount = candidatesQuery.data?.counts?.total
    ?? candidatesQuery.data?.candidates?.length
    ?? 0;

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("google") === "connected") {
      toast({ title: "Google connected", description: "OXUS is importing your contacts and calendar in the background." });
      void google.refetch();
      params.delete("google");
      navigate(`/crm${params.toString() ? `?${params}` : ""}`, { replace: true });
    } else if (params.get("google") === "error") {
      toast({
        title: "Google connection failed",
        description: params.get("message") ? decodeURIComponent(params.get("message")!) : "Please try again from Settings.",
        variant: "destructive",
      });
      params.delete("google");
      params.delete("message");
      navigate(`/crm${params.toString() ? `?${params}` : ""}`, { replace: true });
    }
  }, [search, navigate, toast, google]);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const t = params.get("tab");
    if (t === "companies" || t === "organizations") setTab("companies");
    else if (t === "people") setTab("people");
    else if (t === "leads") setTab("leads");
    else if (t === "import") setImportCenterOpen(true);
    if (params.get("review") === "1") setImportCenterOpen(true);
    const view = params.get("view");
    if (view && tab === "people") setPeopleViewId(view);
    if (view && tab === "companies") setCompanyViewId(view);
  }, [search, tab]);

  const setTabAndPersist = (next: CrmTab) => {
    setTab(next);
    saveLastCrmTab(next);
    const params = new URLSearchParams(search);
    params.set("tab", next);
    navigate(`/crm?${params.toString()}`, { replace: true });
  };

  const clientsQuery = useClients();
  const contactsQuery = useContacts();
  const invoicesQuery = useInvoices({ enabled: isSuperAdmin });
  const projectsQuery = useProjects();
  const quotesQuery = useQuotes({ enabled: isSuperAdmin });

  const clients = (clientsQuery.data ?? []).filter((c) => isListableInCrm(c));
  const contacts = (contactsQuery.data ?? []).filter((c) => isListableInCrm(c) && !c.is_role_inbox);
  const allClients = clientsQuery.data ?? [];
  const allContacts = contactsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const quotes = quotesQuery.data ?? [];
  const calendarEvents = calendarQuery.data ?? [];

  const activeClientsCount = clients.filter((c) => isInCrmPool(c) && c.company_type === "client").length;
  const leadRows = useMemo(
    () => quotes.filter((q) => q.stage === "new-lead" || q.stage === "scoping" || q.stage === "proposal"),
    [quotes],
  );

  const meetingsThisMonth = useMemo(() => {
    const now = new Date();
    const interval = { start: startOfMonth(now), end: endOfMonth(now) };
    return calendarEvents.filter((ev) => {
      if (!ev.event_date) return false;
      if (!isWithinInterval(parseISO(ev.event_date), interval)) return false;
      return ((ev.attendee_emails as string[] | null) ?? []).some(isExternalAttendeeEmail);
    }).length;
  }, [calendarEvents]);

  const clientMetrics = useMemo(() => {
    const map = new Map<string, { revenue: number; outstanding: number; projects: number }>();
    for (const c of clients) map.set(c.id, { revenue: 0, outstanding: 0, projects: 0 });
    for (const inv of invoices) {
      if (!inv.client_id) continue;
      const m = map.get(inv.client_id) ?? { revenue: 0, outstanding: 0, projects: 0 };
      if (inv.status === "paid") m.revenue += invoiceTotalEur(inv) ?? 0;
      if (isOutstandingReceivable(inv)) m.outstanding += invoiceAmountDueEur(inv) ?? 0;
      map.set(inv.client_id, m);
    }
    for (const p of projects) {
      const id = p.organization_id ?? p.client_id;
      if (!id) continue;
      const m = map.get(id) ?? { revenue: 0, outstanding: 0, projects: 0 };
      if (!p.archived_at && !p.is_draft && (p.status === "in-progress" || p.status === "planning")) m.projects += 1;
      map.set(id, m);
    }
    return map;
  }, [clients, invoices, projects]);

  const contactById = useMemo(() => new Map(allContacts.map((c) => [c.id, c])), [allContacts]);

  const primaryContactByCompany = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of allClients) {
      if (c.primary_contact_id) {
        const p = contactById.get(c.primary_contact_id);
        if (p) map.set(c.id, p);
      }
    }
    for (const c of allContacts) {
      if (c.client_id && !map.has(c.client_id) && !c.is_role_inbox) map.set(c.client_id, c);
    }
    return map;
  }, [allClients, allContacts, contactById]);

  const applyPeopleView = (list: Contact[], viewId: string) => {
    const view = PEOPLE_SAVED_VIEWS.find((v) => v.id === viewId) ?? PEOPLE_SAVED_VIEWS[0];
    const now = new Date();
    const includeReview = !!view.filters.include_review;
    return list.filter((p) => {
      if (view.filters.active_only && !isInCrmPool(p, false)) return false;
      if (includeReview) {
        if (!isListableInCrm(p)) return false;
        if (view.filters.quality === "needs_review") {
          if (p.data_quality_status !== "needs_review" && p.visibility_state !== "needs_review") return false;
        }
      } else if (view.filters.quality === "needs_review") {
        if (p.data_quality_status !== "needs_review" && p.visibility_state !== "needs_review") return false;
      }
      if (view.filters.owner === "me" && p.relationship_owner_id !== user?.id) return false;
      if (view.filters.unassigned_owner && p.relationship_owner_id) return false;
      // Legacy unassigned-by-company filter (kept for older view ids)
      if (view.filters.unassigned && (p.client_id || p.company)) return false;
      if (view.filters.relationship === "client" && p.type !== "client") return false;
      if (view.filters.relationship === "prospect" && p.type !== "lead") return false;
      if (view.filters.relationship === "vendor_partner" && !["vendor", "partner"].includes(p.type)) return false;
      if (view.filters.status === "inactive" && p.person_status !== "inactive" && p.visibility_state !== "inactive") return false;
      if (view.filters.recently_active === "30d") {
        const at = p.last_interaction_at ?? p.last_contact_at;
        if (!at || parseISO(at) < subDays(now, 30)) return false;
      }
      if (view.filters.has_meetings) {
        if (!p.next_meeting_at && !(typeof p.meeting_count === "number" && p.meeting_count > 0)) return false;
      }
      return true;
    });
  };

  const applyCompanyView = (list: Client[], viewId: string) => {
    const view = COMPANY_SAVED_VIEWS.find((v) => v.id === viewId) ?? COMPANY_SAVED_VIEWS[0];
    const now = new Date();
    const includeReview = !!view.filters.include_review;
    return list.filter((c) => {
      if (view.filters.active_only && !isInCrmPool(c, false)) return false;
      if (includeReview && view.filters.quality === "needs_review") {
        if (c.data_quality_status !== "needs_review" && c.visibility_state !== "needs_review" && !c.needs_review) return false;
      }
      if (view.filters.company_type && c.company_type !== view.filters.company_type) return false;
      if (view.filters.recently_active === "30d") {
        if (!c.last_interaction_at || parseISO(c.last_interaction_at) < subDays(now, 30)) return false;
      }
      if (view.filters.no_interaction === "90d") {
        if (c.last_interaction_at && parseISO(c.last_interaction_at) >= subDays(now, 90)) return false;
      }
      return true;
    });
  };

  const filteredCompanies = useMemo(() => {
    const q = searchTerm.toLowerCase();
    const rows = applyCompanyView(clients, companyViewId).filter((c) => {
      if (!q) return true;
      const primary = primaryContactByCompany.get(c.id);
      return (
        c.name.toLowerCase().includes(q)
        || (c.registrable_domain ?? c.primary_domain ?? "").toLowerCase().includes(q)
        || (c.website ?? "").toLowerCase().includes(q)
        || (primary?.name ?? "").toLowerCase().includes(q)
        || (primary?.email ?? "").toLowerCase().includes(q)
      );
    });
    return [...rows].sort((a, b) => {
      const rank = (c: Client) => {
        if (c.company_type === "client") return 0;
        if (c.company_type === "prospect") return 1;
        return 2;
      };
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      const aAt = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
      const bAt = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
      if (aAt !== bAt) return bAt - aAt;
      return (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name);
    });
  }, [clients, companyViewId, searchTerm, primaryContactByCompany]);

  const filteredPeople = useMemo(() => {
    const q = searchTerm.toLowerCase();
    const rows = applyPeopleView(contacts, peopleViewId).filter((c) => {
      if (!q) return true;
      const companyName = clients.find((cl) => cl.id === c.client_id)?.name ?? c.company ?? "";
      return (
        c.name.toLowerCase().includes(q)
        || (c.email ?? "").toLowerCase().includes(q)
        || companyName.toLowerCase().includes(q)
        || (c.job_title ?? "").toLowerCase().includes(q)
      );
    });
    return [...rows].sort((a, b) => {
      const aAt = new Date(a.last_interaction_at ?? a.last_contact_at ?? 0).getTime();
      const bAt = new Date(b.last_interaction_at ?? b.last_contact_at ?? 0).getTime();
      if (aAt !== bAt) return bAt - aAt;
      return (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name);
    });
  }, [contacts, peopleViewId, searchTerm, clients]);

  const filteredLeads = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return leadRows.filter((l) => !q || (l.company ?? "").toLowerCase().includes(q)
      || (l.contact_name ?? "").toLowerCase().includes(q)
      || (l.project_name ?? "").toLowerCase().includes(q));
  }, [leadRows, searchTerm]);

  // Prefer server review workspace counts so KPI matches Import Center tabs.
  const needsReviewTotal = candidatesQuery.data?.counts?.total
    ?? (
      allClients.filter((c) => entityNeedsReview(c)).length
      + allContacts.filter((c) => entityNeedsReview(c)).length
    );

  const companyColumns = [
    {
      id: "company",
      header: "Company",
      className: "min-w-[220px]",
      cell: (c: Client) => (
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9 border">
            {c.logo_url ? <AvatarImage src={c.logo_url} alt={c.name} /> : null}
            <AvatarFallback className="bg-muted text-muted-foreground">{initials(c.display_name ?? c.name)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold flex items-center gap-2">
              {c.display_name ?? c.name}
              <CrmQualityBadge status={c.data_quality_status} />
            </div>
            {(c.registrable_domain ?? c.primary_domain ?? c.website) && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {(c.registrable_domain ?? c.website ?? "").replace(/^https?:\/\//, "")}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "relationship",
      header: "Relationship",
      cell: (c: Client) => <StatusBadge status={c.company_type ?? "unknown"} variant="neutral" />,
    },
    {
      id: "primary_contact",
      header: "Primary contact",
      cell: (c: Client) => {
        const p = primaryContactByCompany.get(c.id);
        return p ? <span className="text-sm">{p.display_name ?? p.name}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    { id: "people", header: "People", cell: (c: Client) => allContacts.filter((p) => p.client_id === c.id).length },
    { id: "active_projects", header: "Active projects", cell: (c: Client) => clientMetrics.get(c.id)?.projects ?? 0 },
    { id: "lifetime_revenue", header: "Lifetime revenue", cell: (c: Client) => formatEUR(clientMetrics.get(c.id)?.revenue ?? 0) },
    { id: "outstanding", header: "Outstanding", cell: (c: Client) => formatEUR(clientMetrics.get(c.id)?.outstanding ?? 0) },
    {
      id: "last_interaction",
      header: "Last interaction",
      cell: (c: Client) => formatLastInteractionAt(c.last_interaction_at),
    },
    {
      id: "next_meeting",
      header: "Next meeting",
      cell: (c: Client) => formatNextMeetingAt(c.next_meeting_at),
    },
    { id: "source", header: "Source", cell: (c: Client) => c.source ?? parseEntitySources(c.source, c.aggregated_sources).join(", ") },
  ];

  const peopleColumns = [
    {
      id: "person",
      header: "Name",
      className: "min-w-[200px]",
      cell: (p: Contact) => (
        <div className="flex items-center gap-3">
          <Avatar className="w-8 h-8">
            {p.avatar_url ? <AvatarImage src={p.avatar_url} alt={p.name} /> : null}
            <AvatarFallback className="bg-muted text-muted-foreground">{initials(p.display_name ?? p.name)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium flex items-center gap-2">
              {p.display_name ?? p.name}
              {personQualityBadge(p) ? (
                <Badge variant="outline" className="text-[10px] font-normal">{personQualityBadge(p)}</Badge>
              ) : (
                <CrmQualityBadge status={p.data_quality_status} />
              )}
            </div>
            {p.job_title ? <div className="text-xs text-muted-foreground">{p.job_title}</div> : null}
          </div>
        </div>
      ),
    },
    { id: "email", header: "Email", cell: (p: Contact) => p.email ?? "—" },
    { id: "phone", header: "Phone", cell: (p: Contact) => p.phone ?? "—" },
    {
      id: "owner",
      header: "Owner",
      cell: (p: Contact) => (p.relationship_owner_id === user?.id ? "You" : p.relationship_owner_id ? "Assigned" : "No owner"),
    },
    {
      id: "primary_company",
      header: "Primary company",
      cell: (p: Contact) => clients.find((c) => c.id === p.client_id)?.name ?? p.company ?? "—",
    },
    { id: "relationship", header: "Relationship", cell: (p: Contact) => <StatusBadge status={p.relationship_type ?? p.type} variant="neutral" /> },
    {
      id: "last_interaction",
      header: "Last activity",
      cell: (p: Contact) => formatLastInteractionAt(p.last_interaction_at ?? p.last_contact_at),
    },
    {
      id: "next_meeting",
      header: "Next meeting",
      cell: (p: Contact) => formatNextMeetingAt(p.next_meeting_at),
    },
    { id: "source", header: "Source", cell: (p: Contact) => p.source ?? parseEntitySources(p.source, p.aggregated_sources).join(", ") },
    {
      id: "created",
      header: "Created",
      cell: (p: Contact) => p.created_at ? new Date(p.created_at).toLocaleDateString() : "—",
    },
  ];

  const leadColumns = [
    { id: "company", header: "Company", cell: (q: Quote) => q.company ?? "—" },
    { id: "contact", header: "Contact", cell: (q: Quote) => q.contact_name ?? "—" },
    { id: "project", header: "Project", cell: (q: Quote) => q.project_name ?? q.project_type ?? "—" },
    { id: "stage", header: "Stage", cell: (q: Quote) => <StatusBadge status={q.stage} variant="info" /> },
    { id: "value", header: "Value", cell: (q: Quote) => formatEUR(Number(q.budget)) },
    {
      id: "proposal",
      header: "Proposal",
      cell: (q: Quote) => (
        <Link href={`/quotes/${q.id}`} className="text-primary text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
          View
        </Link>
      ),
    },
  ];

  const isLoading = clientsQuery.isLoading || contactsQuery.isLoading;
  const isError = clientsQuery.isError || contactsQuery.isError;
  const showEmptyGuidance = allClients.length + allContacts.length <= 5 && !isLoading;
  const savedViews = getPrimarySavedViewsForTab(tab);
  const activeViewId = tab === "people" ? peopleViewId : companyViewId;
  const activePeopleCount = applyPeopleView(contacts, "all").length;
  const activeCompaniesCount = applyCompanyView(clients, "all").length;
  const hasActivePeopleFilters = peopleViewId !== "all" || searchTerm.trim().length > 0;
  const hasActiveCompanyFilters = companyViewId !== "all" || searchTerm.trim().length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="CRM"
        subtitle={`${activePeopleCount} contacts · ${activeCompaniesCount} companies`}
        actions={isSuperAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportCenterOpen(true)}>
              <Inbox className="w-4 h-4 mr-2" />
              Review{pendingReviewCount > 0 ? ` (${pendingReviewCount})` : ""}
            </Button>
            <CrmAddRecordMenu />
          </div>
        ) : undefined}
      />

      {isSuperAdmin && !google.connected && <GoogleConnection variant="banner" redirectAfter="/crm" />}
      {isSuperAdmin && google.connected && (
        <GoogleConnection variant="strip" redirectAfter="/crm" onImportCenter={() => setImportCenterOpen(true)} />
      )}

      <CrmKpiStrip
        peopleCount={activePeopleCount}
        companiesCount={activeCompaniesCount}
        activeClientsCount={activeClientsCount}
        needsReviewCount={needsReviewTotal}
        secondaryLine={`Open leads ${leadRows.length} · Meetings this month ${meetingsThisMonth}`}
        onPeopleClick={() => setTabAndPersist("people")}
        onCompaniesClick={() => setTabAndPersist("companies")}
        onActiveClientsClick={() => { setCompanyViewId("clients"); setTabAndPersist("companies"); }}
        onNeedsReviewClick={() => setImportCenterOpen(true)}
      />

      <Tabs value={tab} onValueChange={(v) => setTabAndPersist(v as CrmTab)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="companies">Companies</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="leads">Leads</TabsTrigger>}
          </TabsList>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={tab === "people" ? "Search contacts…" : "Search CRM…"}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search contacts"
            />
          </div>
        </div>
      </Tabs>

      {(tab === "people" || tab === "companies") && savedViews.length > 0 && (
        <CrmSavedViewBar
          views={savedViews}
          activeViewId={activeViewId}
          onViewChange={(id) => {
            if (tab === "people") setPeopleViewId(id);
            else setCompanyViewId(id);
          }}
        />
      )}

      {isLoading && <TableSkeleton rows={6} />}
      {isError && (
        <ErrorState
          error={clientsQuery.error ?? contactsQuery.error}
          onRetry={() => { void clientsQuery.refetch(); void contactsQuery.refetch(); }}
        />
      )}

      {!isLoading && !isError && tab === "people" && (
        filteredPeople.length === 0 ? (
          <EmptyState
            title={hasActivePeopleFilters ? "No contacts match these filters" : "No contacts yet"}
            description={hasActivePeopleFilters
              ? "Try clearing filters or switching to All contacts."
              : "Contacts come from Google Contacts, Calendar meetings, Gmail relationships, Projects, and manual entry."}
            action={hasActivePeopleFilters ? (
              <Button variant="outline" onClick={() => { setPeopleViewId("all"); setSearchTerm(""); }}>
                Clear filters
              </Button>
            ) : (showEmptyGuidance && isSuperAdmin ? (
              <div className="flex flex-wrap gap-2 justify-center">
                {!google.connected && <GoogleConnection variant="compact" redirectAfter="/crm" />}
                <CrmAddRecordMenu />
              </div>
            ) : undefined)}
          />
        ) : (
          <DataTable tableId="crm-people" data={filteredPeople} columns={peopleColumns} onRowClick={setSelectedContact} pageSize={20} />
        )
      )}

      {!isLoading && !isError && tab === "companies" && (
        filteredCompanies.length === 0 ? (
          <EmptyState
            title={hasActiveCompanyFilters ? "No companies match these filters" : "No companies"}
            description={hasActiveCompanyFilters
              ? "Try clearing filters or switching to All companies."
              : "Add your first company or connect Google to import organizations."}
            action={hasActiveCompanyFilters ? (
              <Button variant="outline" onClick={() => { setCompanyViewId("all"); setSearchTerm(""); }}>
                Clear filters
              </Button>
            ) : (showEmptyGuidance && isSuperAdmin ? (
              <div className="flex flex-wrap gap-2 justify-center">
                {!google.connected && <GoogleConnection variant="compact" redirectAfter="/crm" />}
                <CrmAddRecordMenu />
              </div>
            ) : undefined)}
          />
        ) : (
          <DataTable tableId="crm-companies" data={filteredCompanies} columns={companyColumns} onRowClick={setSelectedOrg} pageSize={20} />
        )
      )}

      {!isLoading && !isError && tab === "leads" && isSuperAdmin && (
        filteredLeads.length === 0 ? (
          <EmptyState title="No leads" description="Pipeline leads appear here from Quotes or quick-create." action={<CrmAddRecordMenu />} />
        ) : (
          <DataTable tableId="crm-leads" data={filteredLeads} columns={leadColumns} onRowClick={setSelectedLead} pageSize={20} />
        )
      )}

      <CompanyDetailDrawer company={selectedOrg} open={!!selectedOrg} onOpenChange={(open) => !open && setSelectedOrg(null)} />
      <PersonDetailDrawer
        person={selectedContact}
        open={!!selectedContact}
        onOpenChange={(open) => !open && setSelectedContact(null)}
        onPersonUpdated={(updated) => setSelectedContact(updated)}
      />

      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setSelectedLead(null)}>
          <div className="bg-card border rounded-lg shadow-lg max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg">{selectedLead.project_name ?? selectedLead.company}</h3>
            <p className="text-sm text-muted-foreground">{selectedLead.company} · {selectedLead.contact_name ?? "No contact"}</p>
            <Button asChild className="w-full"><Link href={`/quotes/${selectedLead.id}`}>Open lead in Quotes</Link></Button>
          </div>
        </div>
      )}

      <CrmImportCenterDialog open={importCenterOpen} onOpenChange={setImportCenterOpen} />
    </div>
  );
}

/** @deprecated Use CRM — kept for route compatibility */
export const Contacts = CRM;
