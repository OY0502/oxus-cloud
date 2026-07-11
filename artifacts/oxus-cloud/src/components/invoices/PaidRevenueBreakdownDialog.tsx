import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/StatusBadge";
import {
  formatFxRate,
  formatMinorEur,
  formatOriginalPaid,
  paidRevenueRowsToCsv,
  reconciliationSourceBadge,
  reconciliationStatusLabel,
  stripeBalanceTransactionUrl,
  stripeChargeUrl,
  type PaidRevenueSummary,
} from "@/lib/paymentReconciliation";
import { formatReportingMonthLabel, REPORTING_TIMEZONE } from "@/lib/reportingTimezone";
import type { InvoicePaymentReconciliation } from "@/lib/types";
import { ChevronDown, ChevronRight, Download, ExternalLink, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaidRevenueBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monthKey: string;
  rows: InvoicePaymentReconciliation[];
  summary: PaidRevenueSummary;
  isLoading?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

function sourceVariant(basis: InvoicePaymentReconciliation["amount_basis"]) {
  switch (basis) {
    case "stripe_actual_settlement":
    case "native_eur":
      return "success" as const;
    case "ecb_reference":
    case "paid_out_of_band_reference":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

function PaymentRow({ row }: { row: InvoicePaymentReconciliation }) {
  const [expanded, setExpanded] = useState(false);
  const invoice = row.invoices;
  const stripeInvoiceUrl = invoice?.external_url ?? invoice?.hosted_invoice_url ?? null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full text-left p-3 hover:bg-muted/40 flex items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="mt-0.5 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="grid flex-1 gap-2 md:grid-cols-[120px_1fr_120px_120px_100px_100px_100px_90px] md:items-center text-sm">
          <span className="text-muted-foreground whitespace-nowrap">
            {new Date(row.paid_at).toLocaleDateString("en-US", { timeZone: REPORTING_TIMEZONE, month: "short", day: "numeric" })}
          </span>
          <div>
            <div className="font-medium">{invoice?.number ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{invoice?.client_name ?? "—"}</div>
          </div>
          <span>{formatOriginalPaid(row)}</span>
          <span className="text-xs">{formatFxRate(row)}</span>
          <span className="font-medium">{formatMinorEur(row.gross_eur_minor)}</span>
          <span className="text-danger">{formatMinorEur(row.stripe_fee_eur_minor)}</span>
          <span>{formatMinorEur(row.net_eur_minor)}</span>
          <StatusBadge status={reconciliationStatusLabel(row)} variant={sourceVariant(row.amount_basis)} />
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-0 ml-7 space-y-3 text-sm border-t bg-muted/20">
          <div className="flex flex-wrap gap-2 pt-3">
            <Badge variant="outline">{reconciliationSourceBadge(row)}</Badge>
            {row.is_paid_out_of_band && <Badge variant="outline">Paid outside Stripe</Badge>}
          </div>
          <dl className="grid gap-2 sm:grid-cols-2 text-xs">
            <div><dt className="text-muted-foreground">Invoice Payment ID</dt><dd className="font-mono break-all">{row.external_invoice_payment_id ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">PaymentIntent ID</dt><dd className="font-mono break-all">{row.external_payment_intent_id ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Charge ID</dt><dd className="font-mono break-all">{row.external_charge_id ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Balance Transaction ID</dt><dd className="font-mono break-all">{row.external_balance_transaction_id ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Settlement currency</dt><dd>{row.settlement_currency ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Stripe exchange rate</dt><dd>{row.stripe_exchange_rate != null ? Number(row.stripe_exchange_rate).toFixed(6) : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Reference ECB rate/date</dt><dd>{row.reference_rate_to_eur != null ? `${Number(row.reference_rate_to_eur).toFixed(6)} on ${row.reference_rate_date ?? "—"}` : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Reference EUR</dt><dd>{formatMinorEur(row.reference_eur_minor)}</dd></div>
          </dl>
          {row.fee_details.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Stripe fee details</p>
              <ul className="space-y-1 text-xs">
                {row.fee_details.map((fd, i) => (
                  <li key={i} className="font-mono">
                    {(fd.description ?? fd.type ?? "fee")}: {((fd.amount ?? 0) / 100).toFixed(2)} {String(fd.currency ?? "").toUpperCase()}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Gross EUR ({formatMinorEur(row.gross_eur_minor)}) − Stripe fees ({formatMinorEur(row.stripe_fee_eur_minor)}) = Net EUR ({formatMinorEur(row.net_eur_minor)})
          </p>
          <div className="flex flex-wrap gap-2">
            {stripeInvoiceUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={stripeInvoiceUrl} target="_blank" rel="noreferrer">
                  Open invoice in Stripe <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
            {stripeChargeUrl(row.external_charge_id) && (
              <Button variant="outline" size="sm" asChild>
                <a href={stripeChargeUrl(row.external_charge_id)!} target="_blank" rel="noreferrer">
                  Open payment in Stripe <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
            {stripeBalanceTransactionUrl(row.external_balance_transaction_id) && (
              <Button variant="outline" size="sm" asChild>
                <a href={stripeBalanceTransactionUrl(row.external_balance_transaction_id)!} target="_blank" rel="noreferrer">
                  Balance transaction <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
          </div>
          {row.sync_error && <p className="text-xs text-danger">{row.sync_error}</p>}
        </div>
      )}
    </div>
  );
}

export function PaidRevenueBreakdownDialog({
  open,
  onOpenChange,
  monthKey,
  rows,
  summary,
  isLoading,
  onRefresh,
  isRefreshing,
}: PaidRevenueBreakdownDialogProps) {
  const monthLabel = formatReportingMonthLabel(monthKey);

  const exportCsv = () => {
    const csv = paidRevenueRowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paid-revenue-${monthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const unresolvedWarning = summary.unresolvedCount > 0 || summary.referenceCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paid revenue breakdown — {monthLabel}</DialogTitle>
          <DialogDescription>
            Gross paid revenue reconciled from Stripe payments and balance transactions. Reporting timezone: {REPORTING_TIMEZONE}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 justify-end">
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing…" : "Reconcile from Stripe"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Gross paid</p>
            <p className="kpi-value text-success">{formatMinorEur(summary.grossEurMinor)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Stripe fees</p>
            <p className="kpi-value text-danger">−{formatMinorEur(summary.stripeFeesEurMinor)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Net received</p>
            <p className="kpi-value">{formatMinorEur(summary.netEurMinor)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Reference FX difference</p>
            <p className="kpi-value text-sm">{formatMinorEur(summary.referenceFxDifferenceMinor)}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 text-xs text-muted-foreground">
          <span>Payments: {summary.paymentCount}</span>
          <span>Stripe actual/native: {summary.reconciledActualCount}</span>
          <span>Reference/unresolved: {summary.referenceCount + summary.unresolvedCount}</span>
        </div>

        {unresolvedWarning && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {summary.referenceCount > 0 && `${summary.referenceCount} payment${summary.referenceCount === 1 ? "" : "s"} use reference FX because no EUR settlement was available. `}
              {summary.unresolvedCount > 0 && `${summary.unresolvedCount} payment${summary.unresolvedCount === 1 ? "" : "s"} could not be fully reconciled.`}
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading reconciliation…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No payment reconciliations for {monthLabel} yet. Run Sync latest or Reconcile from Stripe.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="hidden md:grid grid-cols-[120px_1fr_120px_120px_100px_100px_100px_90px] gap-3 px-10 text-xs font-medium text-muted-foreground">
              <span>Paid date</span><span>Invoice / Client</span><span>Original paid</span><span>FX source</span><span>Gross EUR</span><span>Stripe fees</span><span>Net EUR</span><span>Status</span>
            </div>
            {rows.map((row) => <PaymentRow key={row.id} row={row} />)}
          </div>
        )}

        <div className={cn("rounded-lg border p-4 text-xs text-muted-foreground space-y-2")}>
          <p><strong>Formula:</strong> Gross paid − Stripe fees = Net received</p>
          <p>Reference EUR and actual Stripe settlement EUR can differ because they use different exchange rates.</p>
          <p><strong>Diagnostics:</strong> timezone {REPORTING_TIMEZONE}; month {monthKey}; payments included {summary.paymentCount}; last reconciliation {summary.lastReconciledAt ? new Date(summary.lastReconciledAt).toLocaleString() : "never"}.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
