import type { StatusVariant } from "@/components/StatusBadge";

export const TODAY = new Date("2026-06-15");

export type InvoiceStatus = "draft" | "sent" | "viewed" | "partial" | "overdue" | "paid";

export interface Invoice {
  id: string;
  number: string;
  client: string;
  project: string;
  amount: number;
  amountPaid: number;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  paidDate: string | null;
  paymentMethod: string | null;
  owner: string;
  lastReminder: string | null;
  stripeStatus: string;
  lineItems: { description: string; amount: number }[];
}

interface StatusConfig {
  label: string;
  variant: StatusVariant;
  dot: string;
  accent: string;
}

export const INVOICE_STATUS: Record<InvoiceStatus, StatusConfig> = {
  draft: { label: "Draft", variant: "neutral", dot: "bg-muted-foreground/50", accent: "text-muted-foreground" },
  sent: { label: "Sent", variant: "info", dot: "bg-logo-blue", accent: "text-logo-blue" },
  viewed: { label: "Viewed", variant: "default", dot: "bg-magenta", accent: "text-magenta" },
  partial: { label: "Partially Paid", variant: "warning", dot: "bg-warm-yellow", accent: "text-warm-yellow" },
  overdue: { label: "Overdue", variant: "danger", dot: "bg-soft-red", accent: "text-soft-red" },
  paid: { label: "Paid", variant: "success", dot: "bg-soft-green", accent: "text-soft-green" },
};

export const LIFECYCLE_STAGES: InvoiceStatus[] = ["draft", "sent", "viewed", "partial", "overdue", "paid"];

export function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/** Positive = days remaining until due; negative = days overdue. */
export function daysUntilDue(inv: Invoice): number {
  return daysBetween(new Date(inv.dueDate), TODAY);
}

export function remaining(inv: Invoice): number {
  return Math.max(inv.amount - (inv.amountPaid || 0), 0);
}

export function isDueSoon(inv: Invoice, withinDays = 7): boolean {
  if (inv.status === "paid" || inv.status === "overdue" || inv.status === "draft") return false;
  const d = daysUntilDue(inv);
  return d >= 0 && d <= withinDays;
}

export function needsAttention(inv: Invoice): boolean {
  return inv.status === "overdue" || inv.status === "draft" || isDueSoon(inv);
}

/** Lower number = more urgent, for sorting the Needs Attention hero. */
export function attentionRank(inv: Invoice): number {
  if (inv.status === "overdue") return 0;
  if (isDueSoon(inv)) return 1;
  if (inv.status === "partial") return 2;
  if (inv.status === "draft") return 3;
  return 4;
}

export function formatMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
