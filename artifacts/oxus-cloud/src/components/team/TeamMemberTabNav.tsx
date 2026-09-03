import React from "react";
import { cn } from "@/lib/utils";

export type TeamMemberTab =
  | "overview"
  | "projects"
  | "rates"
  | "payables"
  | "invoices"
  | "payments"
  | "activity"
  | "access";

interface TeamMemberTabNavProps {
  value: TeamMemberTab;
  onChange: (tab: TeamMemberTab) => void;
  className?: string;
  showPayables?: boolean;
  showRates?: boolean;
  showInvoices?: boolean;
  showPayments?: boolean;
  showActivity?: boolean;
  showAccess?: boolean;
}

const TABS: { id: TeamMemberTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "rates", label: "Rates" },
  { id: "payables", label: "Payables" },
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "activity", label: "Activity" },
  { id: "access", label: "Access" },
];

export function TeamMemberTabNav({
  value,
  onChange,
  className,
  showRates = false,
  showPayables = false,
  showInvoices = false,
  showPayments = false,
  showActivity = false,
  showAccess = false,
}: TeamMemberTabNavProps) {
  const visible = TABS.filter((t) => {
    if (t.id === "rates") return showRates;
    if (t.id === "payables") return showPayables;
    if (t.id === "invoices") return showInvoices;
    if (t.id === "payments") return showPayments;
    if (t.id === "activity") return showActivity;
    if (t.id === "access") return showAccess;
    return true;
  });

  return (
    <nav
      aria-label="Team member sections"
      className={cn(
        "grid grid-cols-4 border-b border-border/70 sm:grid-cols-7",
        className,
      )}
    >
      {visible.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={value === tab.id ? "page" : undefined}
          onClick={() => onChange(tab.id)}
          className={cn(
            "min-w-0 border-b-2 px-1 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            value === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
