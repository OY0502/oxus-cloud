import React, { useState } from "react";

import { DataTable } from "@/components/DataTable";

import { StatusBadge } from "@/components/StatusBadge";

import { Button } from "@/components/ui/button";

import {

  usePayoutsWithAllocations,

  useTeamMemberSummary,

  useContractorInvoiceSummary,

} from "@/hooks/api";

import { formatCurrency } from "@/lib/currency";

import type { Contact, PayoutWithAllocations } from "@/lib/types";

import { EurReportingValue } from "./EurReportingValue";
import { RecordPaymentDialog } from "./TeamDialogs";
import { Plus } from "lucide-react";
import { TeamMiniStat, TeamOutlineButton, TeamPanelHeader, teamIcon } from "./teamUi";



export function TeamMemberPaymentsPanel({

  person,

  canManage,

  onRecordPayment,

}: {

  person: Contact;

  canManage: boolean;

  onRecordPayment?: () => void;

}) {

  const { data: payouts = [], isLoading } = usePayoutsWithAllocations(person.id, { enabled: canManage });

  const summaryQuery = useTeamMemberSummary(person.id, { enabled: canManage, includeFinancials: true });

  const invoiceSummary = useContractorInvoiceSummary(person.id, { enabled: canManage });

  const summary = summaryQuery.data;

  const [recordOpen, setRecordOpen] = useState(false);



  const openRecord = () => {

    if (onRecordPayment) onRecordPayment();

    else setRecordOpen(true);

  };



  const columns = [

    { id: "date", header: "Date", cell: (p: PayoutWithAllocations) => p.payment_date ?? "—" },

    { id: "amount", header: "Amount", cell: (p: PayoutWithAllocations) => formatCurrency(p.amount, p.currency, true) },

    {

      id: "period",

      header: "Period",

      cell: (p: PayoutWithAllocations) =>

        p.period_start && p.period_end ? `${p.period_start} – ${p.period_end}` : "—",

    },

    {

      id: "invoices",

      header: "Invoices",

      cell: (p: PayoutWithAllocations) => {

        const links = p.contractor_invoice_payments ?? [];

        if (links.length === 0) return "—";

        return links

          .map((l) => l.contractor_invoices?.invoice_number ?? l.contractor_invoice_id.slice(0, 8))

          .join(", ");

      },

    },

    { id: "provider", header: "Provider", cell: (p: PayoutWithAllocations) => <StatusBadge status={p.provider} variant="neutral" /> },

    { id: "status", header: "Status", cell: (p: PayoutWithAllocations) => <StatusBadge status={p.status} variant="neutral" /> },

    { id: "notes", header: "Notes", cell: (p: PayoutWithAllocations) => p.notes ?? "—" },

  ];



  if (!canManage) {

    return <p className="text-sm text-muted-foreground">Payment details are restricted to admins.</p>;

  }



  return (
    <div className="min-w-0 space-y-4">
      <TeamPanelHeader
        title="Payments"
        action={
          <TeamOutlineButton onClick={openRecord}>
            <Plus className={teamIcon} /> Record payment
          </TeamOutlineButton>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <TeamMiniStat
          label="Paid this month"
          value={
            <EurReportingValue
              aggregate={summary?.paid_mtd_eur}
              fallback={formatCurrency(summary?.paid_mtd ?? 0)}
            />
          }
        />
        <TeamMiniStat
          label="Paid YTD"
          value={
            <EurReportingValue
              aggregate={summary?.paid_ytd_eur}
              fallback={formatCurrency(summary?.paid_ytd ?? 0)}
            />
          }
        />
        <TeamMiniStat label="Lifetime paid" value={formatCurrency(summary?.lifetime_paid ?? 0)} />
        <TeamMiniStat label="Outstanding invoices" value={formatCurrency(invoiceSummary.data?.outstanding ?? 0)} />
        <TeamMiniStat label="Pending payouts" value={formatCurrency(summary?.pending ?? 0)} />
      </div>



      {summary?.last_payment_date && (

        <p className="text-xs text-muted-foreground">Last payment: {summary.last_payment_date}</p>

      )}



      {isLoading ? (

        <p className="text-sm text-muted-foreground">Loading payments…</p>

      ) : payouts.length === 0 ? (

        <p className="text-sm text-muted-foreground">No payments recorded yet.</p>

      ) : (

        <DataTable tableId={`team-payments-${person.id}`} data={payouts} columns={columns} />

      )}



      {!onRecordPayment && (

        <RecordPaymentDialog open={recordOpen} onOpenChange={setRecordOpen} person={person} />

      )}

    </div>

  );

}


