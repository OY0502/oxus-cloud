import React, { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  usePayoutsWithAllocations,
  useTeamMemberSummary,
} from "@/hooks/api";
import { formatCurrency, formatEUR } from "@/lib/currency";
import type { Contact } from "@/lib/types";
import { EurReportingValue } from "./EurReportingValue";
import { RecordPaymentDialog } from "./TeamDialogs";
import { Plus } from "lucide-react";
import {
  TeamEmptyState,
  TeamMiniStat,
  TeamOutlineButton,
  TeamPanelHeader,
  TeamRecordField,
  TeamRecordItem,
  TeamRecordList,
  teamIcon,
} from "./teamUi";

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
  const summary = summaryQuery.data;
  const [recordOpen, setRecordOpen] = useState(false);

  const openRecord = () => {
    if (onRecordPayment) onRecordPayment();
    else setRecordOpen(true);
  };

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
          label="Paid this year"
          value={
            <EurReportingValue
              aggregate={summary?.paid_ytd_eur}
              fallback={formatCurrency(summary?.paid_ytd ?? 0)}
            />
          }
        />
        <TeamMiniStat label="Lifetime paid" value={formatCurrency(summary?.lifetime_paid ?? 0)} />
        <TeamMiniStat
          label="Outstanding"
          value={formatEUR(summary?.outstanding_payables ?? summary?.outstanding_invoices ?? 0)}
        />
        <TeamMiniStat label="Pending payouts" value={formatCurrency(summary?.pending ?? 0)} />
      </div>

      {summary?.last_payment_date && (
        <p className="text-xs text-muted-foreground">Last payment on {summary.last_payment_date}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading payments…</p>
      ) : payouts.length === 0 ? (
        <TeamEmptyState
          title="No payments"
          description="Recorded payments will appear here with their period, provider, and invoice allocations."
        />
      ) : (
        <TeamRecordList>
          {payouts.map((payout) => {
            const invoiceLabels = (payout.contractor_invoice_payments ?? []).map(
              (link) => link.contractor_invoices?.invoice_number ?? link.contractor_invoice_id.slice(0, 8),
            );
            const period = payout.period_start && payout.period_end
              ? `${payout.period_start} – ${payout.period_end}`
              : "—";

            return (
              <TeamRecordItem
                key={payout.id}
                title={
                  <>
                    <span>Payment {payout.payment_date ? `· ${payout.payment_date}` : ""}</span>
                    <StatusBadge status={payout.status} variant={payout.status === "completed" ? "success" : "neutral"} />
                  </>
                }
                subtitle={invoiceLabels.length > 0 ? `Invoices · ${invoiceLabels.join(", ")}` : payout.notes ?? "Unallocated payment"}
                trailing={
                  <>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(payout.amount, payout.currency, true)}
                    </div>
                  </>
                }
                details={
                  <>
                    <TeamRecordField label="Period">{period}</TeamRecordField>
                    <TeamRecordField label="Provider">{payout.provider}</TeamRecordField>
                    <TeamRecordField label="Notes">{payout.notes ?? "—"}</TeamRecordField>
                  </>
                }
              />
            );
          })}
        </TeamRecordList>
      )}

      {!onRecordPayment && (
        <RecordPaymentDialog open={recordOpen} onOpenChange={setRecordOpen} person={person} />
      )}
    </div>
  );
}
