import React, { useMemo, useState } from "react";

import { Link, useRoute } from "wouter";

import { PageHeader } from "@/components/PageHeader";

import { MetricCard } from "@/components/MetricCard";

import { StatusBadge } from "@/components/StatusBadge";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { Button } from "@/components/ui/button";

import { useContacts, useTeamMemberSummary, useCompanyPeople, useProfiles } from "@/hooks/api";

import { TableSkeleton, ErrorState } from "@/components/states/QueryStates";

import { useAuth } from "@/contexts/AuthContext";

import { formatEUR } from "@/lib/currency";

import {

  availabilityLabel,

  availabilityVariant,

  engagementLabel,

  engagementVariant,

  formatRate,

  personInitials,

  personStatusVariant,

} from "@/lib/team";

import { TeamMemberOverview } from "@/components/team/TeamMemberOverview";

import { TeamMemberProjects } from "@/components/team/TeamMemberProjects";

import { TeamMemberRatesPanel } from "@/components/team/TeamMemberRates";

import { TeamMemberPaymentsPanel } from "@/components/team/TeamMemberPayments";

import { TeamMemberInvoicesPanel } from "@/components/team/TeamMemberInvoices";

import { TeamMemberActivity } from "@/components/team/TeamMemberActivity";

import { TeamMemberAccessPanel } from "@/components/team/TeamMemberAccess";

import { TeamMemberTabNav, type TeamMemberTab } from "@/components/team/TeamMemberTabNav";

import { RecordPaymentDialog } from "@/components/team/TeamDialogs";

import { ArrowLeft, Briefcase, Clock, Wallet } from "lucide-react";



export function TeamMemberDetail() {

  const [, params] = useRoute("/team/:id");

  const personId = params?.id ?? "";

  const { isSuperAdmin } = useAuth();

  const [tab, setTab] = useState<TeamMemberTab>("overview");

  const [editing, setEditing] = useState(false);

  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);

  const [preselectedInvoiceId, setPreselectedInvoiceId] = useState<string | null>(null);



  const contactsQuery = useContacts();

  const summaryQuery = useTeamMemberSummary(personId, {

    includeFinancials: isSuperAdmin,

  });

  const { data: companyPeople = [] } = useCompanyPeople();

  const { data: profiles = [] } = useProfiles();



  const person = contactsQuery.data?.find((c) => c.id === personId);

  const summary = summaryQuery.data;



  const hasWorkspaceAccount = useMemo(() => {

    const email = person?.email?.trim().toLowerCase();

    if (!email) return false;

    return profiles.some((p) => p.email?.trim().toLowerCase() === email);

  }, [profiles, person?.email]);



  if (contactsQuery.isLoading) return <TableSkeleton rows={4} />;

  if (!person) {

    return <ErrorState error={new Error("Team member not found.")} onRetry={() => void contactsQuery.refetch()} />;

  }



  const currentRate = summary?.current_rate;

  const openRecordPayment = (invoiceId?: string) => {

    setPreselectedInvoiceId(invoiceId ?? null);

    setRecordPaymentOpen(true);

  };



  return (

    <div className="min-w-0 space-y-6">

      <div className="flex items-start gap-4">

        <Button variant="ghost" size="icon" asChild>

          <Link href="/team"><ArrowLeft className="w-4 h-4" /></Link>

        </Button>

        <Avatar className="w-12 h-12 border border-border/60">

          {person.avatar_url ? <AvatarImage src={person.avatar_url} alt={person.name} /> : null}

          <AvatarFallback className="text-base">{personInitials(person.name)}</AvatarFallback>

        </Avatar>

        <div className="flex-1 min-w-0">

          <PageHeader

            title={person.name}

            subtitle={[person.job_title, engagementLabel(person, companyPeople)].filter(Boolean).join(" · ")}

          />

          <div className="flex flex-wrap items-center gap-2 text-sm">

            <span className="text-muted-foreground">{person.email ?? "No email"}</span>

            <StatusBadge status={engagementLabel(person, companyPeople)} variant={engagementVariant()} />

            <StatusBadge

              status={person.person_status === "active" ? "Active" : "Inactive"}

              variant={personStatusVariant(person.person_status)}

            />

            {person.availability && (

              <StatusBadge status={availabilityLabel(person.availability)} variant={availabilityVariant(person.availability)} />

            )}

          </div>

        </div>

        <Button variant="outline" size="sm" className="h-9" asChild>

          <Link href="/team">Back to roster</Link>

        </Button>

      </div>



      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

        {isSuperAdmin && (

          <MetricCard

            title="Current rate"

            value={currentRate ? formatRate(currentRate) : "—"}

            icon={<Clock className="w-5 h-5" />}

          />

        )}

        {isSuperAdmin && (

          <>

            <MetricCard title="Paid this month" value={formatEUR(summary?.paid_mtd ?? 0)} icon={<Wallet className="w-5 h-5" />} />

            <MetricCard title="Paid YTD" value={formatEUR(summary?.paid_ytd ?? 0)} icon={<Wallet className="w-5 h-5" />} />

            <MetricCard title="Outstanding invoices" value={formatEUR(summary?.outstanding_invoices ?? 0)} icon={<Wallet className="w-5 h-5" />} />

          </>

        )}

        <MetricCard title="Active projects" value={String(summary?.active_projects ?? 0)} icon={<Briefcase className="w-5 h-5" />} />

      </div>



      <div className="min-w-0 space-y-4">

        <TeamMemberTabNav

          value={tab}

          onChange={(v) => { setTab(v); if (v !== "overview") setEditing(false); }}

          showRates={isSuperAdmin}

          showInvoices={isSuperAdmin}

          showPayments={isSuperAdmin}

          showActivity

          showAccess={isSuperAdmin && hasWorkspaceAccount}

        />



        {tab === "overview" && (

          <div className="max-w-3xl">

            <TeamMemberOverview

              person={person}

              summary={summary}

              canEdit={isSuperAdmin}

              showFinancials={isSuperAdmin}

              editing={editing}

              onEditingChange={setEditing}

            />

          </div>

        )}



        {tab === "projects" && <TeamMemberProjects person={person} canManage={isSuperAdmin} />}



        {tab === "rates" && isSuperAdmin && <TeamMemberRatesPanel person={person} canManage={isSuperAdmin} />}



        {tab === "invoices" && isSuperAdmin && (

          <TeamMemberInvoicesPanel person={person} canManage={isSuperAdmin} onRecordPayment={openRecordPayment} />

        )}



        {tab === "payments" && isSuperAdmin && (

          <TeamMemberPaymentsPanel person={person} canManage={isSuperAdmin} onRecordPayment={() => openRecordPayment()} />

        )}



        {tab === "activity" && (

          <div className="max-w-2xl">

            <TeamMemberActivity person={person} />

          </div>

        )}



        {tab === "access" && isSuperAdmin && hasWorkspaceAccount && (

          <div className="max-w-xl">

            <TeamMemberAccessPanel person={person} />

          </div>

        )}

      </div>



      {isSuperAdmin && (

        <RecordPaymentDialog

          open={recordPaymentOpen}

          onOpenChange={setRecordPaymentOpen}

          person={person}

          preselectedInvoiceId={preselectedInvoiceId}

        />

      )}

    </div>

  );

}


