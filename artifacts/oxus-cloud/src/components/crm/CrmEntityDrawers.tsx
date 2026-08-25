import React, { useMemo } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Building2, ExternalLink, Globe, Mail, Phone, Users, Briefcase, DollarSign, Activity,
} from "lucide-react";
import { formatLastInteractionAt } from "@/lib/crm/interactionDates";
import { EntityDrawer } from "@/components/EntityDrawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  useClients, useContacts, useCompanyPeople, useProjects, useInvoices, useQuotes,
  useGoogleInteractions, useContactActivities,
} from "@/hooks/api";
import type { Client, Contact } from "@/lib/types";
import { formatEUR } from "@/lib/currency";
import { invoiceTotalEur, invoiceAmountDueEur } from "@/lib/invoiceEur";
import { isOutstandingReceivable } from "@/lib/invoiceClassification";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type CompanyDrawerProps = {
  company: Client | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CompanyDetailDrawer({ company, open, onOpenChange }: CompanyDrawerProps) {
  const clientsQuery = useClients();
  const contactsQuery = useContacts();
  const projectsQuery = useProjects();
  const invoicesQuery = useInvoices();
  const quotesQuery = useQuotes();
  const companyPeopleQuery = useCompanyPeople(company?.id);
  const interactionsQuery = useGoogleInteractions(company?.id);

  const clients = clientsQuery.data ?? [];
  const contacts = contactsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const quotes = quotesQuery.data ?? [];

  const metrics = useMemo(() => {
    if (!company) return null;
    const companyProjects = projects.filter((p) => (p.organization_id ?? p.client_id) === company.id);
    const activeProjects = companyProjects.filter((p) => !p.archived_at && (p.status === "in-progress" || p.status === "planning"));
    const companyInvoices = invoices.filter((i) => i.client_id === company.id);
    const revenue = companyInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);
    const outstanding = companyInvoices.filter(isOutstandingReceivable).reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);
    const people = companyPeopleQuery.data ?? [];
    return { activeProjects: activeProjects.length, revenue, outstanding, peopleCount: people.length };
  }, [company, projects, invoices, companyPeopleQuery.data]);

  if (!company) return null;

  const companyPeople = companyPeopleQuery.data ?? [];
  const companyProjects = projects.filter((p) => (p.organization_id ?? p.client_id) === company.id);
  const companyQuotes = quotes.filter((q) => q.organization_id === company.id);
  const interactions = interactionsQuery.data ?? [];

  return (
    <EntityDrawer
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[600px]"
      title={company.name}
      description={company.company_type ?? "client"}
      headerActions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/companies/${company.id}`}>Full page</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <Avatar className="w-14 h-14 border">
            {company.logo_url ? <AvatarImage src={company.logo_url} alt={company.name} /> : null}
            <AvatarFallback>{initials(company.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={company.company_type ?? "client"} variant="neutral" />
              <StatusBadge status={company.status ?? "active"} variant={company.status === "active" ? "success" : "neutral"} />
            </div>
            {company.website && (
              <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary flex items-center gap-1">
                <Globe className="w-3 h-3" /> {company.website.replace(/^https?:\/\//, "")} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4 text-center"><Briefcase className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><div className="font-semibold">{metrics.activeProjects}</div><div className="text-xs text-muted-foreground">Active projects</div></CardContent></Card>
            <Card><CardContent className="pt-4 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><div className="font-semibold">{formatEUR(metrics.revenue)}</div><div className="text-xs text-muted-foreground">Lifetime revenue</div></CardContent></Card>
            <Card><CardContent className="pt-4 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><div className="font-semibold">{formatEUR(metrics.outstanding)}</div><div className="text-xs text-muted-foreground">Outstanding</div></CardContent></Card>
            <Card><CardContent className="pt-4 text-center"><Users className="w-4 h-4 mx-auto mb-1 text-muted-foreground" /><div className="font-semibold">{metrics.peopleCount}</div><div className="text-xs text-muted-foreground">People</div></CardContent></Card>
          </div>
        )}

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="commercial">Commercial</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3 text-sm">
            {company.description && <p>{company.description}</p>}
            {company.industry && <p><span className="text-muted-foreground">Industry:</span> {company.industry}</p>}
            {(company.city || company.country) && <p><span className="text-muted-foreground">Location:</span> {[company.city, company.country].filter(Boolean).join(", ")}</p>}
            {company.source && <p><span className="text-muted-foreground">Source:</span> {company.source}</p>}
            {company.last_interaction_at && <p><span className="text-muted-foreground">Last interaction:</span> {formatLastInteractionAt(company.last_interaction_at)}</p>}
            {company.notes && <Card><CardContent className="pt-4 text-muted-foreground">{company.notes}</CardContent></Card>}
          </TabsContent>

          <TabsContent value="people" className="space-y-2">
            {companyPeople.length === 0 ? <p className="text-sm text-muted-foreground">No linked people.</p> : companyPeople.map((cp) => {
              const person = cp.contacts ?? contacts.find((c) => c.id === cp.person_id);
              return (
                <div key={cp.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <div className="font-medium">{person?.name ?? "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">{cp.relationship_type}{person?.job_title ? ` · ${person.job_title}` : ""}</div>
                  </div>
                  {person && <Button asChild variant="ghost" size="sm"><Link href={`/team/${person.id}`}>Open</Link></Button>}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="activity" className="space-y-2">
            {interactions.length === 0 ? <p className="text-sm text-muted-foreground">No synced interactions yet.</p> : interactions.map((i) => (
              <div key={i.id} className="border rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2"><Activity className="w-4 h-4" /><span className="font-medium">{i.subject ?? i.interaction_type}</span></div>
                <p className="text-muted-foreground mt-1">{i.ai_summary ?? i.snippet ?? ""}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(i.occurred_at), { addSuffix: true })}</p>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="projects" className="space-y-2">
            {companyProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="block border rounded-lg p-3 hover:bg-muted/50">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.status}</div>
              </Link>
            ))}
          </TabsContent>

          <TabsContent value="commercial" className="space-y-2">
            {companyQuotes.map((q) => (
              <Link key={q.id} href={`/quotes/${q.id}`} className="block border rounded-lg p-3 hover:bg-muted/50">
                <div className="font-medium">{q.project_name ?? q.project_type ?? "Proposal"}</div>
                <div className="text-xs text-muted-foreground">{q.stage} · {formatEUR(Number(q.budget))}</div>
              </Link>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </EntityDrawer>
  );
}

type PersonDrawerProps = {
  person: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPersonUpdated?: (person: Contact) => void;
};

export { PersonDetailDrawer } from "./record/PersonDetailDrawer";
