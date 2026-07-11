import React from "react";
import { cn } from "@/lib/utils";

export type TeamMemberTab =
  | "overview"
  | "projects"
  | "rates"
  | "invoices"
  | "payments"
  | "activity"
  | "access";

interface TeamMemberTabNavProps {
  value: TeamMemberTab;
  onChange: (tab: TeamMemberTab) => void;
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
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "activity", label: "Activity" },
  { id: "access", label: "Access" },
];

export function TeamMemberTabNav({
  value,
  onChange,
  showRates = false,
  showInvoices = false,
  showPayments = false,
  showActivity = false,
  showAccess = false,
}: TeamMemberTabNavProps) {
  const visible = TABS.filter((t) => {
    if (t.id === "rates") return showRates;
    if (t.id === "invoices") return showInvoices;
    if (t.id === "payments") return showPayments;
    if (t.id === "activity") return showActivity;
    if (t.id === "access") return showAccess;
    return true;
  });

  return (
    <nav className="-mb-px flex gap-4 overflow-x-auto border-b border-border">
      {visible.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "shrink-0 border-b-2 pb-2.5 text-sm font-medium transition-colors",
            value === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
