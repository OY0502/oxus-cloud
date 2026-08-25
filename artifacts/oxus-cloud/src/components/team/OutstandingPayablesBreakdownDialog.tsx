import React, { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  useChangeTeamMemberPayableState,
  useTeamPayablesSummary,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { formatEUR, formatCurrency } from "@/lib/currency";
import {
  payableStateVariant,
  payableUiStateLabel,
  releaseConditionLabel,
} from "@/lib/teamMemberPayables";
import type { TeamMemberPayableEnriched } from "@/lib/types";
import { AlertTriangle } from "lucide-react";

interface OutstandingPayablesBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecordPayment?: (personId: string, payableId?: string) => void;
}

export function OutstandingPayablesBreakdownDialog({
  open,
  onOpenChange,
  onRecordPayment,
}: OutstandingPayablesBreakdownDialogProps) {
  const { toast } = useToast();
  const changeState = useChangeTeamMemberPayableState();
  const summaryQuery = useTeamPayablesSummary({ period: "lifetime" }, { enabled: open });

  const payables = useMemo(() => {
    return (summaryQuery.data?.payables ?? []).filter(
      (p) => p.approval_status === "approved" && p.payment_status !== "paid",
    );
  }, [summaryQuery.data]);

  const summary = summaryQuery.data?.summary;

  const act = async (payable: TeamMemberPayableEnriched, action: "approve" | "release" | "cancel") => {
    try {
      await changeState.mutateAsync({ payable_id: payable.id, action });
      toast({ title: `Payable ${action === "approve" ? "approved" : action === "release" ? "released" : "cancelled"}` });
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      id: "member",
      header: "Team member",
      cell: (p: TeamMemberPayableEnriched) => p.contacts?.name ?? "—",
    },
    {
      id: "project",
      header: "Project",
      cell: (p: TeamMemberPayableEnriched) => p.projects?.name ?? "—",
    },
    {
      id: "invoice",
      header: "Client invoice",
      cell: (p: TeamMemberPayableEnriched) => p.invoices?.number ?? p.invoices?.client_name ?? "—",
    },
    {
      id: "period",
      header: "Period",
      cell: (p: TeamMemberPayableEnriched) => {
        if (p.period_start && p.period_end) return `${p.period_start} – ${p.period_end}`;
        return p.period_start ?? p.period_end ?? "—";
      },
    },
    {
      id: "native",
      header: "Original",
      cell: (p: TeamMemberPayableEnriched) => formatCurrency(p.amount, p.currency),
    },
    {
      id: "eur",
      header: "EUR",
      cell: (p: TeamMemberPayableEnriched) => p.amount_eur != null ? formatEUR(p.amount_eur) : "—",
    },
    {
      id: "paid",
      header: "Paid",
      cell: (p: TeamMemberPayableEnriched) => formatCurrency(p.paid_amount, p.currency),
    },
    {
      id: "remaining",
      header: "Remaining",
      cell: (p: TeamMemberPayableEnriched) => formatCurrency(p.remaining_amount, p.currency),
    },
    {
      id: "release",
      header: "Release",
      cell: (p: TeamMemberPayableEnriched) => releaseConditionLabel(p.release_condition),
    },
    {
      id: "state",
      header: "State",
      cell: (p: TeamMemberPayableEnriched) => (
        <StatusBadge status={payableUiStateLabel(p.ui_state)} variant={payableStateVariant(p.ui_state)} />
      ),
    },
    {
      id: "due",
      header: "Due",
      cell: (p: TeamMemberPayableEnriched) => p.due_date ?? "—",
    },
    {
      id: "actions",
      header: "",
      cell: (p: TeamMemberPayableEnriched) => (
        <div className="flex flex-wrap gap-1">
          {p.approval_status === "draft" && (
            <Button size="sm" variant="outline" onClick={() => void act(p, "approve")}>Approve</Button>
          )}
          {p.ui_state === "waiting_for_release" && (
            <Button size="sm" variant="outline" onClick={() => void act(p, "release")}>Release</Button>
          )}
          {["ready_to_pay", "partially_paid"].includes(p.ui_state) && onRecordPayment && (
            <Button size="sm" variant="outline" onClick={() => onRecordPayment(p.person_id, p.id)}>Pay</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Outstanding payables</DialogTitle>
          <DialogDescription>Approved team compensation not yet fully paid.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Total outstanding</p>
            <p className="font-semibold tabular-nums">{formatEUR(summary?.outstanding_eur?.total_eur ?? 0)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Ready to pay</p>
            <p className="font-semibold tabular-nums">{formatEUR(summary?.ready_to_pay_eur?.total_eur ?? 0)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Waiting</p>
            <p className="font-semibold tabular-nums">{formatEUR(summary?.waiting_eur?.total_eur ?? 0)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Payable count</p>
            <p className="font-semibold tabular-nums">{summary?.payable_count ?? 0}</p>
          </div>
        </div>

        {(summary?.fx_unavailable_count ?? 0) > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {summary?.fx_unavailable_count} payable(s) lack EUR conversion and are excluded from EUR totals.
            </AlertDescription>
          </Alert>
        )}

        <DataTable
          data={payables}
          columns={columns}
          tableId="outstanding-payables"
          pageSize={20}
          enablePagination
        />
      </DialogContent>
    </Dialog>
  );
}
