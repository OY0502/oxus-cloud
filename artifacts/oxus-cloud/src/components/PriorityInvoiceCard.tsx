import React from "react";
import { Eye, CheckCircle2, Bell, Send, CreditCard, AlertTriangle, Clock, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  type Invoice,
  INVOICE_STATUS,
  daysUntilDue,
  remaining,
  formatMoney,
  formatDateShort,
} from "@/lib/invoices";

interface PriorityInvoiceCardProps {
  invoice: Invoice;
  onView?: () => void;
  onMarkPaid?: () => void;
  onSendReminder?: () => void;
  onSend?: () => void;
}

type Tone = "urgent" | "warm" | "neutral";

function getTone(inv: Invoice): Tone {
  if (inv.status === "overdue") return "urgent";
  if (inv.status === "draft") return "neutral";
  return "warm";
}

const TONE_STYLES: Record<Tone, { bar: string; ring: string; glow: string; chip: string }> = {
  urgent: {
    bar: "bg-soft-red",
    ring: "border-soft-red/30",
    glow: "shadow-[0_1px_2px_rgba(11,26,51,0.05),0_16px_36px_-14px_rgba(229,115,115,0.55)]",
    chip: "bg-soft-red/10 text-soft-red",
  },
  warm: {
    bar: "bg-warm-yellow",
    ring: "border-warm-yellow/30",
    glow: "shadow-[0_1px_2px_rgba(11,26,51,0.05),0_16px_36px_-16px_rgba(245,200,66,0.5)]",
    chip: "bg-warm-yellow/10 text-warm-yellow",
  },
  neutral: {
    bar: "bg-muted-foreground/40",
    ring: "border-border",
    glow: "shadow-[0_1px_2px_rgba(11,26,51,0.04),0_14px_30px_-18px_rgba(11,26,51,0.25)]",
    chip: "bg-muted text-muted-foreground",
  },
};

export function PriorityInvoiceCard({ invoice, onView, onMarkPaid, onSendReminder, onSend }: PriorityInvoiceCardProps) {
  const tone = getTone(invoice);
  const styles = TONE_STYLES[tone];
  const cfg = INVOICE_STATUS[invoice.status];
  const d = daysUntilDue(invoice);

  const timing =
    invoice.status === "draft"
      ? { icon: <FileText className="h-3.5 w-3.5" />, text: "Not sent yet" }
      : d < 0
      ? { icon: <AlertTriangle className="h-3.5 w-3.5" />, text: `${Math.abs(d)} ${Math.abs(d) === 1 ? "day" : "days"} overdue` }
      : { icon: <Clock className="h-3.5 w-3.5" />, text: d === 0 ? "Due today" : `${d} ${d === 1 ? "day" : "days"} left` };

  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  const primary =
    invoice.status === "draft"
      ? { label: "Send Invoice", icon: <Send className="mr-2 h-4 w-4" />, action: onSend }
      : invoice.status === "partial"
      ? { label: "Record Payment", icon: <CreditCard className="mr-2 h-4 w-4" />, action: onMarkPaid }
      : { label: "Send Reminder", icon: <Bell className="mr-2 h-4 w-4" />, action: onSendReminder };

  return (
    <div
      onClick={onView}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card p-5 transition-all duration-300 hover:-translate-y-1",
        styles.ring,
        styles.glow
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-1", styles.bar)} />

      {/* header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight text-foreground">{invoice.client}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-mono">{invoice.number}</span> · {invoice.project}
          </p>
        </div>
        <StatusBadge status={cfg.label} variant={cfg.variant} className="shrink-0" />
      </div>

      {/* amount + timing */}
      <div className="mb-4 flex items-end justify-between gap-2">
        <div>
          <p className="font-serif text-3xl font-bold leading-none text-foreground">{formatMoney(remaining(invoice))}</p>
          {invoice.amountPaid > 0 && invoice.status !== "paid" && (
            <p className="mt-1 text-[11px] text-muted-foreground">{formatMoney(invoice.amountPaid)} of {formatMoney(invoice.amount)} paid</p>
          )}
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", styles.chip)}>
          {timing.icon}
          {timing.text}
        </span>
      </div>

      {/* meta */}
      <div className="mb-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-[11px]">
        <Meta label="Due" value={formatDateShort(invoice.dueDate)} />
        <Meta label="Stripe" value={invoice.stripeStatus} />
        <Meta label="Reminder" value={invoice.lastReminder ?? "None"} />
      </div>

      {/* actions */}
      <div className="mt-auto flex items-center gap-2">
        <Button
          size="sm"
          onClick={stop(primary.action)}
          className={cn(
            "h-9 flex-1",
            tone === "urgent"
              ? "bg-soft-red text-white hover:bg-soft-red/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {primary.icon}
          {primary.label}
        </Button>
        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <IconButton title="View" onClick={stop(onView)}>
            <Eye className="h-4 w-4" />
          </IconButton>
          {invoice.status !== "draft" && (
            <IconButton title="Mark Paid" onClick={stop(onMarkPaid)} className="hover:text-soft-green">
              <CheckCircle2 className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className="mt-0.5 truncate font-medium text-foreground">{value}</p>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  className,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}
