import React from "react";
import { useTeamPayablesSummary, useInvoices } from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import { formatEUR } from "@/lib/currency";

interface ProjectTeamCostSectionProps {
  projectId: string;
}

export function ProjectTeamCostSection({ projectId }: ProjectTeamCostSectionProps) {
  const { isSuperAdmin } = useAuth();
  const payablesQuery = useTeamPayablesSummary(
    { project_id: projectId, period: "lifetime" },
    { enabled: isSuperAdmin && !!projectId },
  );
  const invoicesQuery = useInvoices({ enabled: isSuperAdmin });

  if (!isSuperAdmin) return null;

  const payables = (payablesQuery.data?.payables ?? []).filter((p) => p.approval_status === "approved");
  const allocated = payables.reduce((s, p) => s + (p.amount_eur ?? 0), 0);
  const paid = payables.reduce((s, p) => s + (p.paid_amount_eur ?? 0), 0);
  const outstanding = payables.reduce((s, p) => {
    if (p.amount_eur == null || Number(p.amount) <= 0) return s;
    return s + (p.remaining_amount / Number(p.amount)) * Number(p.amount_eur);
  }, 0);

  const revenue = (invoicesQuery.data ?? [])
    .filter((i) => i.project_id === projectId && i.status === "paid")
    .reduce((s, i) => s + (Number((i as { total_eur?: number | null }).total_eur) || Number(i.total)), 0);

  const expectedMargin = revenue > 0 ? revenue - allocated : null;
  const marginAfterPaid = revenue > 0 ? revenue - paid : null;

  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-4 space-y-3">
      <h3 className="text-sm font-semibold">Team cost</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Accrued payables</p>
          <p className="font-semibold tabular-nums">{formatEUR(allocated)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Paid</p>
          <p className="font-semibold tabular-nums">{formatEUR(paid)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Outstanding</p>
          <p className="font-semibold tabular-nums">{formatEUR(outstanding)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Client revenue</p>
          <p className="font-semibold tabular-nums">{formatEUR(revenue)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Expected margin</p>
          <p className="font-semibold tabular-nums">{expectedMargin != null ? formatEUR(expectedMargin) : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Margin after paid costs</p>
          <p className="font-semibold tabular-nums">{marginAfterPaid != null ? formatEUR(marginAfterPaid) : "—"}</p>
        </div>
      </div>
    </div>
  );
}
