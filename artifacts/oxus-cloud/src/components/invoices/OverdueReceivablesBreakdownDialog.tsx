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
import { InvoiceActionMenu } from "@/components/invoices/InvoiceActionMenu";
import {
  type Invoice,
  type StripeInvoiceActionType,
  formatMoney,
  formatInvoiceAmount,
  formatDate,
  getAvailableInvoiceActions,
  formatProviderLabel,
  stripeDashboardUrl,
  invoiceFinancialCategory,
} from "@/lib/invoices";
import {
  classifyInvoiceFinancialState,
  financialCategoryLabel,
  isOverdueReceivable,
} from "@/lib/invoiceClassification";
import { formatInvoiceEurDisplay } from "@/lib/invoiceEur";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface OverdueReceivablesBreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoices: Invoice[];
  missingFxCount?: number;
  onViewInvoice?: (invoice: Invoice) => void;
  onStripeAction?: (invoice: Invoice, action: StripeInvoiceActionType) => void;
}

function overdueRowsToCsv(invoices: Invoice[]): string {
  const header = [
    "Invoice",
    "Client",
    "Due date",
    "Days overdue",
    "Original due",
    "EUR due",
    "Provider",
    "Stripe status",
    "Status",
  ].join(",");
  const rows = invoices.map((inv) => {
    const state = classifyInvoiceFinancialState(inv);
    const eur = formatInvoiceEurDisplay(inv);
    return [
      inv.number,
      inv.client,
      inv.dueDate,
      state.daysOverdue ?? "",
      inv.amountDue,
      eur.unavailable ? "" : eur.text,
      inv.provider,
      inv.stripeStatus,
      inv.status,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });
  return [header, ...rows].join("\n");
}

function OverdueInvoiceRow({
  invoice,
  onViewInvoice,
  onStripeAction,
}: {
  invoice: Invoice;
  onViewInvoice?: (invoice: Invoice) => void;
  onStripeAction?: (invoice: Invoice, action: StripeInvoiceActionType) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const state = classifyInvoiceFinancialState(invoice);
  const eurDisplay = formatInvoiceEurDisplay(invoice);
  const actions = getAvailableInvoiceActions(invoice);
  const stripeUrl = stripeDashboardUrl(invoice);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          className="-my-1 flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 pr-1 text-left hover:bg-muted/40"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <div className="grid min-w-0 flex-1 gap-2 text-sm md:grid-cols-[1fr_120px_100px_100px_90px] md:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium">{invoice.number}</div>
              <div className="truncate text-xs text-muted-foreground">{invoice.client}</div>
            </div>
            <span className="text-muted-foreground whitespace-nowrap">{formatDate(invoice.dueDate)}</span>
            <span className="font-medium text-danger whitespace-nowrap">
              {state.daysOverdue != null ? `${state.daysOverdue}d overdue` : "—"}
            </span>
            <span className="whitespace-nowrap">{formatInvoiceAmount(invoice)}</span>
            <span className={cn("font-medium whitespace-nowrap", eurDisplay.unavailable && "text-muted-foreground")}>
              {eurDisplay.text}
            </span>
          </div>
        </button>
        <InvoiceActionMenu
          invoice={invoice}
          actions={actions.overflow}
          handlers={{
            onView: onViewInvoice,
            onStripeAction,
          }}
        />
      </div>
      {expanded && (
        <div className="space-y-3 border-t bg-muted/20 px-4 pb-4 pt-0 text-sm">
          <div className="flex flex-wrap gap-2 pt-3">
            <StatusBadge status={financialCategoryLabel(invoiceFinancialCategory(invoice))} variant="danger" />
            <Badge variant="outline">{formatProviderLabel(invoice.provider)}</Badge>
            {invoice.stripeStatus && invoice.stripeStatus !== "—" && (
              <Badge variant="outline">Stripe: {invoice.stripeStatus}</Badge>
            )}
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Project</dt><dd>{invoice.project}</dd></div>
            <div><dt className="text-muted-foreground">Issue date</dt><dd>{formatDate(invoice.issueDate)}</dd></div>
            <div><dt className="text-muted-foreground">Amount due (original)</dt><dd>{formatInvoiceAmount(invoice)}</dd></div>
            <div><dt className="text-muted-foreground">EUR due (reporting)</dt><dd>{eurDisplay.text}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {onViewInvoice && (
              <Button variant="outline" size="sm" onClick={() => onViewInvoice(invoice)}>
                View invoice
              </Button>
            )}
            {actions.primary?.stripeAction && onStripeAction && (
              <Button variant="default" size="sm" onClick={() => onStripeAction(invoice, actions.primary!.stripeAction!)}>
                {actions.primary.label}
              </Button>
            )}
            {actions.secondary?.stripeAction && onStripeAction && (
              <Button variant="outline" size="sm" onClick={() => onStripeAction(invoice, actions.secondary!.stripeAction!)}>
                {actions.secondary.label}
              </Button>
            )}
            {stripeUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={stripeUrl} target="_blank" rel="noreferrer">
                  Open in Stripe <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function OverdueReceivablesBreakdownDialog({
  open,
  onOpenChange,
  invoices,
  missingFxCount = 0,
  onViewInvoice,
  onStripeAction,
}: OverdueReceivablesBreakdownDialogProps) {
  const overdueInvoices = useMemo(
    () => invoices
      .filter(isOverdueReceivable)
      .sort((a, b) => {
        const da = classifyInvoiceFinancialState(a).daysOverdue ?? 0;
        const db = classifyInvoiceFinancialState(b).daysOverdue ?? 0;
        return db - da || (classifyInvoiceFinancialState(b).amountDueEur ?? 0) - (classifyInvoiceFinancialState(a).amountDueEur ?? 0);
      }),
    [invoices],
  );

  const totalEur = useMemo(
    () => overdueInvoices.reduce((sum, inv) => sum + (classifyInvoiceFinancialState(inv).amountDueEur ?? 0), 0),
    [overdueInvoices],
  );

  const exportCsv = () => {
    const csv = overdueRowsToCsv(overdueInvoices);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overdue-receivables-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Overdue receivables breakdown</DialogTitle>
          <DialogDescription>
            Active collectible invoices past their due date. Uncollectible and void invoices are excluded from this total.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={overdueInvoices.length === 0}>
            Export CSV
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Overdue EUR total</p>
            <p className="kpi-value text-danger">{formatMoney(totalEur)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Invoices included</p>
            <p className="kpi-value">{overdueInvoices.length}</p>
          </div>
        </div>

        {missingFxCount > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {missingFxCount} non-EUR invoice{missingFxCount === 1 ? "" : "s"} with missing FX conversion are excluded from the EUR total until conversion is available.
            </AlertDescription>
          </Alert>
        )}

        {overdueInvoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No active overdue receivables. Written-off (uncollectible) invoices are not included here.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="hidden pl-10 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[1fr_120px_100px_100px_90px] md:gap-3">
              <span>Invoice / Client</span>
              <span>Due date</span>
              <span>Overdue</span>
              <span>Original due</span>
              <span>EUR due</span>
            </div>
            {overdueInvoices.map((invoice) => (
              <OverdueInvoiceRow
                key={invoice.id}
                invoice={invoice}
                onViewInvoice={onViewInvoice}
                onStripeAction={onStripeAction}
              />
            ))}
          </div>
        )}

        <div className="space-y-2 rounded-lg border p-4 text-xs text-muted-foreground">
          <p><strong>Included:</strong> collectible invoices with a due date in the past and a positive balance due.</p>
          <p><strong>Excluded:</strong> paid, draft, void, uncollectible, and deleted Stripe invoices.</p>
          <p>Stripe mutations run server-side. Use row actions to send reminders, mark paid outside Stripe, or write off debt.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
