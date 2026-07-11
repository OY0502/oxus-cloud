import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { EntityDrawer } from "@/components/EntityDrawer";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard } from "@/components/MetricCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Mail, Phone, Building2, ExternalLink, Plus, Globe, Users, Target,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  useClients, useContacts, useInvoices, useProjects, useQuotes,
} from "@/hooks/api";
import { CreateContactDialog, CreateClientDialog } from "@/components/forms/CreateDialogs";
import { TableSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Client, Contact, Quote } from "@/lib/types";
import { formatEUR } from "@/lib/currency";
import { invoiceTotalEur, invoiceAmountDueEur } from "@/lib/invoiceEur";
import { formatDistanceToNow } from "date-fns";

type Tab = "companies" | "people" | "leads";
type CompanyFilter = "all" | "client" | "prospect" | "partner" | "vendor" | "inactive";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CRM() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("companies");
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Client | null>(null);
  const [createPersonOpen, setCreatePersonOpen] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const t = params.get("tab");
    if (t === "companies" || t === "organizations") setTab("companies");
    else if (t === "people") setTab("people");
    else if (t === "leads") setTab("leads");
    if (params.get("new") === "1") {
      if (!isSuperAdmin) {
        toast({ title: "Only super admins can do this", description: "Ask a super admin to add records.", variant: "destructive" });
        navigate(`/crm?tab=${t ?? "companies"}`, { replace: true });
        return;
      }
      if (t === "companies" || t === "organizations") setCreateOrgOpen(true);
      else setCreatePersonOpen(true);
    }
  }, [search, isSuperAdmin, navigate, toast]);

  const clientsQuery = useClients();
  const contactsQuery = useContacts();
  const invoicesQuery = useInvoices({ enabled: isSuperAdmin });
  const projectsQuery = useProjects();
  const quotesQuery = useQuotes({ enabled: isSuperAdmin });

  const clients = clientsQuery.data ?? [];
  const contacts = contactsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const quotes = quotesQuery.data ?? [];

  const clientMetrics = useMemo(() => {
    const map = new Map<string, { revenue: number; outstanding: number; projects: number }>();
    for (const c of clients) map.set(c.id, { revenue: 0, outstanding: 0, projects: 0 });
    for (const inv of invoices) {
      if (!inv.client_id) continue;
      const m = map.get(inv.client_id) ?? { revenue: 0, outstanding: 0, projects: 0 };
      if (inv.status === "paid") m.revenue += invoiceTotalEur(inv) ?? 0;
      if (["sent", "viewed", "partial", "overdue"].includes(inv.status)) {
        m.outstanding += invoiceAmountDueEur(inv) ?? 0;
      }
      map.set(inv.client_id, m);
    }
    for (const p of projects) {
      const id = p.organization_id ?? p.client_id;
      if (!id) continue;
      const m = map.get(id) ?? { revenue: 0, outstanding: 0, projects: 0 };
      if (p.status === "in-progress" || p.status === "planning") m.projects += 1;
      map.set(id, m);
    }
    return map;
  }, [clients, invoices, projects]);

  const primaryContactByCompany = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) {
      if (c.client_id && !map.has(c.client_id)) map.set(c.client_id, c);
    }
    return map;
  }, [contacts]);

  const filteredCompanies = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return clients.filter((c) => {
      if (companyFilter !== "all" && (c.company_type ?? "client") !== companyFilter) return false;
      if (!q) return true;
      const primary = primaryContactByCompany.get(c.id);
      return (
        c.name.toLowerCase().includes(q) ||
        (c.website ?? "").toLowerCase().includes(q) ||
        (c.billing_email ?? "").toLowerCase().includes(q) ||
        (primary?.name ?? "").toLowerCase().includes(q) ||
        (primary?.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [clients, companyFilter, searchTerm, primaryContactByCompany]);

  const filteredPeople = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return contacts.filter((c) => {
      if (!q) return true;
      const companyName = clients.find((cl) => cl.id === c.client_id)?.name ?? c.company ?? "";
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        companyName.toLowerCase().includes(q)
      );
    });
  }, [contacts, searchTerm, clients]);

  const leadRows = useMemo(() => {
    return quotes.filter((q) => q.stage === "new-lead" || q.stage === "scoping" || q.stage === "proposal");
  }, [quotes]);

  const filteredLeads = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return leadRows.filter((l) => {
      if (!q) return true;
      return (
        (l.company ?? "").toLowerCase().includes(q) ||
        (l.contact_name ?? "").toLowerCase().includes(q) ||
        (l.project_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [leadRows, searchTerm]);

  const companyColumns = [
    {
      id: "company",
      header: "Company",
      className: "min-w-[220px]",
      cell: (c: Client) => (
        <Link href={`/companies/${c.id}`} className="flex items-center gap-3 hover:underline">
          <Avatar className="w-9 h-9 border">
            {c.logo_url ? <AvatarImage src={c.logo_url} alt={c.name} /> : null}
            <AvatarFallback>{initials(c.name)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold">{c.name}</div>
            {c.website && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />{c.website.replace(/^https?:\/\//, "")}
              </div>
            )}
          </div>
        </Link>
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: (c: Client) => <StatusBadge status={c.company_type ?? "client"} variant="neutral" />,
    },
    {
      id: "status",
      header: "Status",
      cell: (c: Client) => <StatusBadge status={c.status ?? "active"} variant={c.status === "active" ? "success" : "neutral"} />,
    },
    {
      id: "primary_contact",
      header: "Primary contact",
      cell: (c: Client) => {
        const p = primaryContactByCompany.get(c.id);
        return p ? <span className="text-sm">{p.name}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "active_projects",
      header: "Active projects",
      cell: (c: Client) => clientMetrics.get(c.id)?.projects ?? 0,
    },
    {
      id: "lifetime_revenue",
      header: "Lifetime revenue",
      cell: (c: Client) => formatEUR(clientMetrics.get(c.id)?.revenue ?? 0),
    },
    {
      id: "outstanding",
      header: "Outstanding",
      cell: (c: Client) => formatEUR(clientMetrics.get(c.id)?.outstanding ?? 0),
    },
  ];

  const peopleColumns = [
    {
      id: "name",
      header: "Name",
      cell: (p: Contact) => (
        <Link href={`/team/${p.id}`} className="flex items-center gap-3 hover:underline">
          <Avatar className="w-8 h-8">
            {p.avatar_url ? <AvatarImage src={p.avatar_url} alt={p.name} /> : null}
            <AvatarFallback>{initials(p.name)}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{p.name}</span>
        </Link>
      ),
    },
    { id: "email", header: "Email", cell: (p: Contact) => p.email ?? "—" },
    {
      id: "company",
      header: "Company",
      cell: (p: Contact) => clients.find((c) => c.id === p.client_id)?.name ?? p.company ?? "—",
    },
    { id: "relationship", header: "Relationship", cell: (p: Contact) => <StatusBadge status={p.type} variant="neutral" /> },
    { id: "title", header: "Title", cell: (p: Contact) => p.job_title ?? "—" },
    {
      id: "last_activity",
      header: "Last activity",
      cell: (p: Contact) =>
        p.last_contact_at
          ? formatDistanceToNow(new Date(p.last_contact_at), { addSuffix: true })
          : "—",
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
        <Link href={`/quotes/${q.id}`} className="text-primary text-sm hover:underline">View</Link>
      ),
    },
  ];

  const isLoading = clientsQuery.isLoading || contactsQuery.isLoading;
  const isError = clientsQuery.isError || contactsQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        subtitle="Companies, people, and pipeline leads in one relationship model."
        actions={
          isSuperAdmin ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateOrgOpen(true)}><Building2 className="w-4 h-4 mr-2" />Company</Button>
              <Button onClick={() => setCreatePersonOpen(true)}><Plus className="w-4 h-4 mr-2" />Person</Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard title="Companies" value={String(clients.length)} icon={<Building2 className="w-5 h-5" />} />
        <MetricCard title="People" value={String(contacts.length)} icon={<Users className="w-5 h-5" />} />
        <MetricCard title="Active leads" value={String(leadRows.length)} icon={<Target className="w-5 h-5" />} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="companies">Companies</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            {isSuperAdmin && <TabsTrigger value="leads">Leads</TabsTrigger>}
          </TabsList>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
      </Tabs>

      {tab === "companies" && (
        <div className="flex flex-wrap gap-2">
          {(["all", "client", "prospect", "partner", "vendor", "inactive"] as CompanyFilter[]).map((f) => (
            <Button key={f} size="sm" variant={companyFilter === f ? "default" : "outline"} onClick={() => setCompanyFilter(f)}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>
      )}

      {isLoading && <TableSkeleton rows={6} />}
      {isError && <ErrorState error={clientsQuery.error ?? contactsQuery.error} onRetry={() => { void clientsQuery.refetch(); void contactsQuery.refetch(); }} />}

      {!isLoading && !isError && tab === "companies" && (
        filteredCompanies.length === 0 ? (
          <EmptyState title="No companies" description="Add your first company to get started." />
        ) : (
          <DataTable tableId="crm-companies" data={filteredCompanies} columns={companyColumns} onRowClick={setSelectedOrg} />
        )
      )}

      {!isLoading && !isError && tab === "people" && (
        filteredPeople.length === 0 ? (
          <EmptyState title="No people" description="Add contacts to your CRM." />
        ) : (
          <DataTable tableId="crm-people" data={filteredPeople} columns={peopleColumns} onRowClick={setSelectedContact} />
        )
      )}

      {!isLoading && !isError && tab === "leads" && isSuperAdmin && (
        filteredLeads.length === 0 ? (
          <EmptyState title="No leads" description="Pipeline leads appear here from Quotes." />
        ) : (
          <DataTable tableId="crm-leads" data={filteredLeads} columns={leadColumns} />
        )
      )}

      <EntityDrawer
        open={!!selectedOrg}
        onOpenChange={(open) => !open && setSelectedOrg(null)}
        title={selectedOrg?.name ?? "Company"}
        description={selectedOrg?.company_type ?? "client"}
        headerActions={
          selectedOrg ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/companies/${selectedOrg.id}`}>Open account hub</Link>
            </Button>
          ) : undefined
        }
      >
        {selectedOrg && (
          <div className="space-y-4 text-sm">
            {selectedOrg.industry && <p><span className="text-muted-foreground">Industry:</span> {selectedOrg.industry}</p>}
            {selectedOrg.website && (
              <a href={selectedOrg.website.startsWith("http") ? selectedOrg.website : `https://${selectedOrg.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary">
                {selectedOrg.website} <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {selectedOrg.notes && <Card><CardContent className="pt-4 text-muted-foreground">{selectedOrg.notes}</CardContent></Card>}
          </div>
        )}
      </EntityDrawer>

      <EntityDrawer
        open={!!selectedContact}
        onOpenChange={(open) => !open && setSelectedContact(null)}
        title={selectedContact?.name ?? "Person"}
        description={selectedContact?.job_title ?? selectedContact?.type}
      >
        {selectedContact && (
          <div className="space-y-3 text-sm">
            {selectedContact.email && <p className="flex items-center gap-2"><Mail className="w-4 h-4" />{selectedContact.email}</p>}
            {selectedContact.phone && <p className="flex items-center gap-2"><Phone className="w-4 h-4" />{selectedContact.phone}</p>}
            <Button asChild variant="outline" size="sm"><Link href={`/team/${selectedContact.id}`}>Open profile</Link></Button>
          </div>
        )}
      </EntityDrawer>

      <CreateClientDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
      <CreateContactDialog open={createPersonOpen} onOpenChange={setCreatePersonOpen} />
    </div>
  );
}

/** @deprecated Use CRM — kept for route compatibility */
export const Contacts = CRM;
