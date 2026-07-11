import React from "react";

import { Eye, Send, AlertTriangle, Clock, FileText, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import { StatusBadge } from "@/components/StatusBadge";

import {

  type Invoice,

  INVOICE_STATUS,

  daysUntilDue,

  remaining,

  formatInvoiceAmount,

  formatDateShort,

  invoiceTotal,

  getAvailableInvoiceActions,

  formatProviderLabel,

  type StripeInvoiceActionType,

} from "@/lib/invoices";

import { formatCurrency } from "@/lib/currency";

interface PriorityInvoiceCardProps {

  invoice: Invoice;

  onView?: () => void;

  onDismiss?: () => void;

  onStripeAction?: (action: StripeInvoiceActionType) => void;

}



type Tone = "urgent" | "warm" | "neutral";



function getTone(inv: Invoice): Tone {

  if (inv.status === "overdue") return "urgent";

  if (inv.status === "draft") return "neutral";

  return "warm";

}



const TONE_STYLES: Record<Tone, { bar: string; ring: string; chip: string }> = {

  urgent: { bar: "bg-danger", ring: "border-danger/20", chip: "bg-danger-muted text-danger" },

  warm: { bar: "bg-warning", ring: "border-warning/20", chip: "bg-warning-muted text-warning" },

  neutral: { bar: "bg-muted-foreground/30", ring: "border-border", chip: "bg-neutral-badge text-neutral-badge-foreground" },

};



export function PriorityInvoiceCard({ invoice, onView, onDismiss, onStripeAction }: PriorityInvoiceCardProps) {

  const tone = getTone(invoice);

  const styles = TONE_STYLES[tone];

  const cfg = INVOICE_STATUS[invoice.status];

  const d = daysUntilDue(invoice);

  const primary = getAvailableInvoiceActions(invoice).primary;

  const isPaid = invoice.status === "paid";

  const currencyCode = invoice.currency ?? "EUR";



  const timing =

    invoice.status === "draft"

      ? { icon: <FileText className="h-3.5 w-3.5" />, text: "Draft — not sent" }

      : d < 0

      ? { icon: <AlertTriangle className="h-3.5 w-3.5" />, text: `${Math.abs(d)} days overdue` }

      : { icon: <Clock className="h-3.5 w-3.5" />, text: d === 0 ? "Due today" : `${d} days left` };



  const stop = (fn?: () => void) => (e: React.MouseEvent) => {

    e.stopPropagation();

    fn?.();

  };



  return (

    <div

      onClick={onView}

      className={cn(

        "group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card p-5 shadow-soft transition-all duration-200 hover:-translate-y-0.5",

        styles.ring,

      )}

    >

      <div className={cn("absolute inset-x-0 top-0 h-0.5", styles.bar)} />



      <div className="mb-3 flex items-start justify-between gap-3">

        <div className="min-w-0">

          <p className="truncate text-base font-semibold">{invoice.client}</p>

          <p className="mt-0.5 truncate text-xs text-muted-foreground">

            <span className="font-mono">{invoice.number}</span>

            {invoice.project !== "—" && <> · {invoice.project}</>}

          </p>

        </div>

        <div className="flex flex-col items-end gap-1">

          <StatusBadge status={cfg.label} variant={cfg.variant} className="shrink-0" />

          {invoice.provider === "stripe" && invoice.stripeStatus !== "—" && (

            <span className="text-[10px] text-muted-foreground capitalize">Stripe: {invoice.stripeStatus}</span>

          )}

        </div>

      </div>



      <div className="mb-3 flex items-end justify-between gap-2">

        <div>

          <p className="font-serif text-3xl font-bold leading-none tabular-nums">

            {formatCurrency(remaining(invoice), currencyCode)}

          </p>

          <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">

            of {formatInvoiceAmount(invoice)} total

          </p>

        </div>

        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium", styles.chip)}>

          {timing.icon}

          {timing.text}

        </span>

      </div>



      <div className="mb-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-[11px]">

        <Meta label="Due" value={formatDateShort(invoice.dueDate)} />

        <Meta label="Provider" value={formatProviderLabel(invoice.provider)} />

      </div>



      <div className="mt-auto flex items-center gap-2">

        {!isPaid && primary?.stripeAction && onStripeAction && (

          <Button

            size="sm"

            onClick={stop(() => onStripeAction(primary.stripeAction!))}

            className={cn("h-9 flex-1", tone === "urgent" ? "bg-danger text-white hover:bg-danger/90" : "bg-primary text-primary-foreground")}

          >

            <Send className="mr-2 h-4 w-4" aria-hidden />

            {primary.label}

          </Button>

        )}

        <Button size="sm" variant="outline" onClick={stop(onView)} className="h-9">

          <Eye className="mr-2 h-4 w-4" /> View

        </Button>

        {onDismiss && (

          <Button size="sm" variant="ghost" onClick={stop(onDismiss)} className="h-9 text-muted-foreground" title="Dismiss permanently">

            <X className="h-4 w-4" />

          </Button>

        )}

      </div>

    </div>

  );

}



function Meta({ label, value }: { label: string; value: string }) {

  return (

    <div className="min-w-0">

      <p className="uppercase tracking-wide text-muted-foreground/70">{label}</p>

      <p className="mt-0.5 truncate font-medium">{value}</p>

    </div>

  );

}


