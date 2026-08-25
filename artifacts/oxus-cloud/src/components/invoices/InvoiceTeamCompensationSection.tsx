import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useTeamPayablesSummary } from "@/hooks/api";
import { formatEUR, formatCurrency } from "@/lib/currency";
import { payableStateVariant, payableUiStateLabel } from "@/lib/teamMemberPayables";
import type { Invoice } from "@/lib/invoices";
import { AllocateTeamCompensationDialog } from "@/components/team/AllocateTeamCompensationDialog";

interface InvoiceTeamCompensationSectionProps {
  invoice: Invoice;
  canManage?: boolean;
  onRecordPayment?: (personId: string) => void;
}

export function InvoiceTeamCompensationSection({
  invoice,
  canManage = false,
  onRecordPayment,
}: InvoiceTeamCompensationSectionProps) {
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const summaryQuery = useTeamPayablesSummary(
    { client_invoice_id: invoice.id, period: "lifetime" },
    { enabled: !!invoice.id },
  );

  const clientSummary = summaryQuery.data?.client_invoice;
  const payables = clientSummary?.payables ?? [];

  if (!clientSummary && payables.length === 0 && !canManage) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Team compensation</h3>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setAllocateOpen(true)}>
              Allocate
            </Button>
            {payables.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowBreakdown((v) => !v)}>
                {showBreakdown ? "Hide" : "Breakdown"}
              </Button>
            )}
          </div>
        )}
      </div>

      {clientSummary ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Allocated</p>
            <p className="font-semibold tabular-nums">{formatEUR(clientSummary.allocated_eur)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Paid</p>
            <p className="font-semibold tabular-nums">{formatEUR(clientSummary.paid_eur)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Remaining</p>
            <p className="font-semibold tabular-nums">{formatEUR(clientSummary.remaining_eur)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Margin</p>
            <p className="font-semibold tabular-nums">
              {clientSummary.margin_eur != null ? formatEUR(clientSummary.margin_eur) : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Team members</p>
            <p className="font-semibold tabular-nums">{clientSummary.team_member_count}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No team compensation allocated yet.</p>
      )}

      {showBreakdown && payables.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          {payables.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <span className="font-medium">{p.contacts?.name ?? "Team member"}</span>
                <span className="text-muted-foreground ml-2">
                  {formatCurrency(p.amount, p.currency)}
                  {p.amount_eur != null ? ` · ${formatEUR(p.amount_eur)}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={payableUiStateLabel(p.ui_state)} variant={payableStateVariant(p.ui_state)} />
                {onRecordPayment && ["ready_to_pay", "partially_paid"].includes(p.ui_state) && (
                  <Button size="sm" variant="outline" onClick={() => onRecordPayment(p.person_id)}>
                    Record payment
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <AllocateTeamCompensationDialog
          open={allocateOpen}
          onOpenChange={setAllocateOpen}
          invoice={invoice}
        />
      )}
    </div>
  );
}
