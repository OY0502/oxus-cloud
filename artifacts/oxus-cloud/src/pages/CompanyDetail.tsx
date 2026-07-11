import React, { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  useClients, useCompanyMetrics, useCompanyPeople,
  useInvoices, useProjects,
} from "@/hooks/api";
import { TableSkeleton, ErrorState } from "@/components/states/QueryStates";
import { formatEUR, formatCurrency } from "@/lib/currency";
import { formatInvoiceEurDisplay } from "@/lib/invoiceEur";
import {
  ArrowLeft, Building2, Briefcase, Receipt, Users, Wallet, AlertTriangle, Globe,
} from "lucide-react";
import type { InvoiceWithItems, ProjectWithAssignees } from "@/lib/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CompanyDetail() {
  const [, params] = useRoute("/companies/:id");
  const companyId = params?.id ?? "";
  const [tab, setTab] = useState("overview");

  const clientsQuery = useClients();
  const metricsQuery = useCompanyMetrics(companyId);
  const peopleQuery = useCompanyPeople(companyId);
  const invoicesQuery = useInvoices();
  const projectsQuery = useProjects();

  const company = clientsQuery.data?.find((c) => c.id === companyId);
  const metrics = metricsQuery.data;
  const invoices = useMemo(
    () => (invoicesQuery.data ?? []).filter((i) => i.client_id === companyId),
    [invoicesQuery.data, companyId],
  );
  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter((p) => p.organization_id === companyId || p.client_id === companyId),
    [projectsQuery.data, companyId],
  );

  if (clientsQuery.isLoading) return <TableSkeleton rows={4} />;
  if (!company) return <ErrorState error={new Error("Company not found.")} onRetry={() => void clientsQuery.refetch()} />;

  const projectColumns = [
    { id: "project", header: "Project", cell: (p: ProjectWithAssignees) => <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link> },
    { id: "status", header: "Status", cell: (p: ProjectWithAssignees) => <StatusBadge status={p.status} variant="neutral" /> },
    { id: "budget", header: "Budget", cell: (p: ProjectWithAssignees) => formatEUR(Number(p.budget)) },
    { id: "deadline", header: "Deadline", cell: (p: ProjectWithAssignees) => p.deadline ?? "—" },
  ];

  const invoiceColumns = [
    { id: "number", header: "Number", cell: (i: InvoiceWithItems) => i.number },
    { id: "amount_orig", header: "Amount (Orig)", cell: (i: InvoiceWithItems) => formatCurrency(Number(i.total || i.amount), i.currency) },
    { id: "amount_eur", header: "Amount (EUR)", cell: (i: InvoiceWithItems) => {
      const eur = formatInvoiceEurDisplay(i);
      return (
        <span className={eur.unavailable ? "text-muted-foreground text-xs" : ""} title={eur.tooltip}>
          {eur.text}
        </span>
      );
    }},
    { id: "status", header: "Status", cell: (i: InvoiceWithItems) => <StatusBadge status={i.status} variant="neutral" /> },
    { id: "due", header: "Due", cell: (i: InvoiceWithItems) => i.due_date ?? "—" },
    {
      id: "link",
      header: "Link",
      cell: (i: InvoiceWithItems) =>
        i.hosted_invoice_url ? (
          <a href={i.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-primary text-sm">Pay link</a>
        ) : "—",
    },
  ];

  const contacts = peopleQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild><Link href="/crm"><ArrowLeft className="w-4 h-4" /></Link></Button>
        <Avatar className="w-14 h-14 border-2">
          <AvatarFallback className="text-lg">{initials(company.name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <PageHeader
            title={company.name}
            subtitle={`${company.company_type ?? "client"} account · ${company.status ?? "active"}`}
          />
          {company.website && (
            <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} className="text-sm text-primary flex items-center gap-1" target="_blank" rel="noopener noreferrer">
              <Globe className="w-3.5 h-3.5" />{company.website}
            </a>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Lifetime revenue" value={formatEUR(metrics?.lifetime_revenue ?? 0)} icon={<Wallet className="w-5 h-5" />} />
            <MetricCard title="Revenue YTD" value={formatEUR(metrics?.revenue_ytd ?? 0)} icon={<Receipt className="w-5 h-5" />} />
            <MetricCard title="Outstanding" value={formatEUR(metrics?.outstanding ?? 0)} icon={<AlertTriangle className="w-5 h-5" />} />
            <MetricCard title="Active projects" value={String(metrics?.active_projects ?? 0)} icon={<Briefcase className="w-5 h-5" />} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Active projects</CardTitle></CardHeader>
              <CardContent>
                {projects.filter((p) => p.status === "in-progress").length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active projects.</p>
                ) : (
                  <ul className="space-y-2">
                    {projects.filter((p) => p.status === "in-progress").slice(0, 5).map((p) => (
                      <li key={p.id}><Link href={`/projects/${p.id}`} className="text-sm hover:underline">{p.name}</Link></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Recent invoices</CardTitle></CardHeader>
              <CardContent>
                {invoices.slice(0, 5).map((inv) => (
                  <div key={inv.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                    <span>{inv.number}</span>
                    <span>{formatEUR(Number(inv.total || inv.amount))}</span>
                  </div>
                ))}
                {invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
              </CardContent>
            </Card>
          </div>
          {company.notes && (
            <Card><CardHeader><CardTitle className="text-base">Account notes</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{company.notes}</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="projects" className="mt-6">
          <DataTable tableId="company-projects" data={projects} columns={projectColumns} />
        </TabsContent>

        <TabsContent value="contacts" className="mt-6">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked contacts.</p>
          ) : (
            <ul className="space-y-3">
              {contacts.map((rel) => (
                <li key={rel.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <Link href={`/team/${rel.person_id}`} className="font-medium hover:underline">{rel.contacts?.name ?? "Contact"}</Link>
                    <p className="text-xs text-muted-foreground">{rel.relationship_type.replace(/_/g, " ")}</p>
                  </div>
                  {rel.contacts?.email && <span className="text-sm text-muted-foreground">{rel.contacts.email}</span>}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="billing" className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-lg">
            <div><p className="text-xs text-muted-foreground">Billing email</p><p>{company.billing_email ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Overdue</p><p className="text-destructive">{formatEUR(metrics?.overdue ?? 0)}</p></div>
          </div>
          <DataTable tableId="company-invoices" data={invoices} columns={invoiceColumns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
