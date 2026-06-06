import React from "react";
import { Eye, CheckCircle2, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface InvoicePaperCardProps {
  invoice: any;
  index?: number;
  onView?: () => void;
  onMarkPaid?: () => void;
  onSendReminder?: () => void;
}

const ROTATIONS = [-2.2, 1.6, -1.1, 2.1, -1.7, 1.2, -0.8, 1.9];

const STAMP = {
  overdue: { label: "Overdue", color: "text-soft-red", border: "border-soft-red/60", bg: "bg-soft-red/5", ring: "shadow-[0_0_0_1px_hsl(var(--soft-red)/0.2)]" },
  pending: { label: "Pending", color: "text-warm-yellow", border: "border-warm-yellow/70", bg: "bg-warm-yellow/5", ring: "" },
  draft:   { label: "Draft",   color: "text-muted-foreground", border: "border-muted-foreground/40", bg: "bg-muted/40", ring: "" },
  paid:    { label: "Paid",    color: "text-soft-green", border: "border-soft-green/60", bg: "bg-soft-green/5", ring: "" },
} as const;

export function InvoicePaperCard({ invoice, index = 0, onView, onMarkPaid, onSendReminder }: InvoicePaperCardProps) {
  const status = (invoice.status as keyof typeof STAMP) || "pending";
  const stamp = STAMP[status] ?? STAMP.pending;
  const isOverdue = status === "overdue";
  const rotation = ROTATIONS[index % ROTATIONS.length];

  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <div
      className="group relative transition-transform duration-300 ease-out hover:z-30 hover:-translate-y-2 hover:rotate-0 hover:scale-[1.025]"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <div
        onClick={onView}
        className={cn(
          "relative cursor-pointer overflow-hidden bg-card transition-shadow duration-300",
          "shadow-[0_1px_2px_rgba(11,26,51,0.06),0_12px_28px_-8px_rgba(11,26,51,0.18)]",
          "group-hover:shadow-[0_2px_6px_rgba(11,26,51,0.08),0_28px_50px_-12px_rgba(11,26,51,0.28)]"
        )}
        style={{
          clipPath: "polygon(0 0, calc(100% - 30px) 0, 100% 30px, 100% 100%, 0 100%)",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E\")",
        }}
      >
        {/* colored top edge */}
        <div
          className={cn(
            "absolute top-0 left-0 h-1.5 w-full",
            isOverdue ? "bg-soft-red" : status === "pending" ? "bg-warm-yellow" : status === "draft" ? "bg-muted-foreground/40" : "bg-soft-green"
          )}
        />
        {/* folded-corner shadow sitting in the clipped notch */}
        <div
          className="absolute top-0 right-0 h-[30px] w-[30px]"
          style={{
            background: "linear-gradient(225deg, rgba(11,26,51,0.16), rgba(11,26,51,0.02) 60%, transparent)",
            clipPath: "polygon(0 0, 100% 100%, 0 100%)",
          }}
        />
        {/* subtle paper sheen */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/50 via-transparent to-transparent dark:from-white/5" />

        <div className="relative flex h-full flex-col p-6 pt-7">
          {/* header: invoice number + stamp */}
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] tracking-wider text-muted-foreground">{invoice.number}</p>
              <p className="mt-1 text-lg font-semibold leading-tight text-foreground">{invoice.client}</p>
            </div>
            <div
              className={cn(
                "shrink-0 select-none rounded-md border-2 px-3 py-1.5 text-base font-extrabold uppercase tracking-[0.18em]",
                "rotate-[-9deg] opacity-90",
                stamp.color,
                stamp.border,
                stamp.bg,
                stamp.ring
              )}
            >
              {stamp.label}
            </div>
          </div>

          {/* amount */}
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Amount due</p>
            <p className="mt-1 font-serif text-4xl font-bold text-foreground">${invoice.amount.toLocaleString()}</p>
          </div>

          {/* footer: due date */}
          <div className="mt-6 flex items-center justify-between border-t border-dashed border-border pt-4 text-xs">
            <span className="text-muted-foreground">
              {status === "draft" ? "Not yet sent" : "Due"}{" "}
              {status !== "draft" && (
                <strong className={cn("font-semibold", isOverdue ? "text-soft-red" : "text-foreground")}>{invoice.dueDate}</strong>
              )}
            </span>
          </div>
        </div>

        {/* hover quick actions */}
        <div className="absolute inset-x-0 bottom-0 flex translate-y-2 items-center justify-center gap-2 bg-gradient-to-t from-card via-card/95 to-transparent p-3 pt-8 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <QuickAction icon={<Eye className="h-3.5 w-3.5" />} label="View" onClick={stop(onView)} />
          <QuickAction
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label="Mark Paid"
            onClick={stop(onMarkPaid)}
            className="text-soft-green hover:bg-soft-green/10 hover:border-soft-green/40"
          />
          <QuickAction
            icon={<Bell className="h-3.5 w-3.5" />}
            label="Remind"
            onClick={stop(onSendReminder)}
            className="text-warm-yellow hover:bg-warm-yellow/10 hover:border-warm-yellow/40"
          />
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted",
        className
      )}
    >
      {icon}
      {label}
    </button>
  );
}
