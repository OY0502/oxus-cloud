import React from "react";
import { cn } from "@/lib/utils";
import {
  type Invoice,
  type InvoiceStatus,
  INVOICE_STATUS,
  LIFECYCLE_STAGES,
  remaining,
  formatMoney,
  formatDateShort,
} from "@/lib/invoices";

interface InvoiceLifecycleBoardProps {
  invoices: Invoice[];
  onCardClick?: (invoice: Invoice) => void;
}

export function InvoiceLifecycleBoard({ invoices, onCardClick }: InvoiceLifecycleBoardProps) {
  const grouped = LIFECYCLE_STAGES.map((stage) => ({
    stage,
    items: invoices.filter((inv) => inv.status === stage),
  }));

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {grouped.map(({ stage, items }) => {
        const cfg = INVOICE_STATUS[stage];
        const total = items.reduce((sum, i) => sum + remaining(i), 0);
        return (
          <div key={stage} className="flex w-64 shrink-0 flex-col rounded-xl border border-border/70 bg-muted/30">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
                <span className="text-sm font-semibold text-foreground">{cfg.label}</span>
                <span className="rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">{items.length}</span>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{formatMoney(total)}</span>
            </div>

            <div className="flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground/60">Empty</p>
              ) : (
                items.map((inv) => (
                  <LifecycleCard key={inv.id} invoice={inv} stage={stage} onClick={() => onCardClick?.(inv)} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LifecycleCard({ invoice, stage, onClick }: { invoice: Invoice; stage: InvoiceStatus; onClick?: () => void }) {
  const cfg = INVOICE_STATUS[stage];
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">{invoice.client}</span>
        <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", cfg.dot)} />
      </div>
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{invoice.number}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{formatMoney(remaining(invoice))}</span>
        <span className="text-[11px] text-muted-foreground">
          {stage === "paid" ? formatDateShort(invoice.paidDate) : formatDateShort(invoice.dueDate)}
        </span>
      </div>
    </button>
  );
}
