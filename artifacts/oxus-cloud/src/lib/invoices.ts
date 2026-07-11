import type { StatusVariant } from "@/components/StatusBadge";
import type { InvoiceWithItems } from "@/lib/types";
import { formatEUR, formatCurrency, EUR_UNAVAILABLE } from "@/lib/currency";
import { formatDistanceToNow } from "date-fns";

/** Real current date for invoice calculations (do not hardcode). */
export const TODAY = new Date();

export type InvoiceStatus = "draft" | "sent" | "viewed" | "partial" | "overdue" | "paid";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface Invoice {
  id: string;
  number: string;
  client: string;
  clientId: string | null;
  project: string;
  projectId: string | null;
  amount: number;
  total: number;
  subtotal: number;
  taxAmount: number;
  amountPaid: number;
  amountDue: number;
  amountEur: number | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  paidDate: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  lastReminder: string | null;
  stripeStatus: string;
  provider: string;
  externalId: string | null;
  hostedInvoiceUrl: string | null;
  externalUrl: string | null;
  syncStatus: string;
  currency: string;
  attentionDismissedAt: string | null;
  lineItems: InvoiceLineItem[];
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
  partial: { label: "Partially Paid", variant: "warning", dot: "bg-warning", accent: "text-warning" },
  overdue: { label: "Overdue", variant: "danger", dot: "bg-danger", accent: "text-danger" },
  paid: { label: "Paid", variant: "success", dot: "bg-success", accent: "text-success" },
};

export const LIFECYCLE_STAGES: InvoiceStatus[] = ["draft", "sent", "viewed", "partial", "overdue", "paid"];

export function invoiceTotal(inv: Invoice): number {
  return inv.total > 0 ? inv.total : inv.amount;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntilDue(inv: Invoice): number {
  return daysBetween(new Date(inv.dueDate), TODAY);
}

export function remaining(inv: Invoice): number {
  if (inv.amountDue > 0) return inv.amountDue;
  return Math.max(invoiceTotal(inv) - (inv.amountPaid || 0), 0);
}

export function isDueSoon(inv: Invoice, withinDays = 7): boolean {
  if (inv.status === "paid" || inv.status === "draft") return false;
  const d = daysUntilDue(inv);
  return d >= 0 && d <= withinDays;
}

export function isAttentionDismissed(inv: Invoice): boolean {
  return !!inv.attentionDismissedAt;
}

export function needsAttention(inv: Invoice): boolean {
  if (isAttentionDismissed(inv)) return false;
  if (inv.status === "paid") return false;
  const stripe = (inv.stripeStatus ?? "").toLowerCase();
  if (stripe === "void" || stripe === "deleted" || stripe === "uncollectible") return false;
  return inv.status === "overdue" || inv.status === "draft" || isDueSoon(inv);
}

export function attentionRank(inv: Invoice): number {
  if (inv.status === "overdue") return 0;
  if (isDueSoon(inv)) return 1;
  if (inv.status === "partial") return 2;
  if (inv.status === "draft") return 3;
  return 4;
}

export function formatMoney(n: number): string {
  return formatEUR(n);
}

export function formatInvoiceAmount(inv: Invoice): string {
  return formatCurrency(invoiceTotal(inv), inv.currency);
}

export function formatInvoiceAmountEur(inv: Invoice): string {
  if (inv.amountEur != null && Number.isFinite(inv.amountEur)) {
    return formatEUR(inv.amountEur);
  }
  if ((inv.currency ?? "EUR").toUpperCase() === "EUR") {
    return formatEUR(invoiceTotal(inv));
  }
  return EUR_UNAVAILABLE;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function stripeDashboardUrl(inv: Invoice): string | null {
  if (inv.externalUrl) return inv.externalUrl;
  if (!inv.externalId) return null;
  return `https://dashboard.stripe.com/invoices/${inv.externalId}`;
}

export function lineItemsSubtotal(inv: Invoice): number {
  return inv.lineItems.reduce((s, li) => s + li.amount, 0);
}

/** Map a Supabase invoice row into the UI shape. */
export function invoiceFromRow(r: InvoiceWithItems): Invoice {
  const total = Number(r.total) || Number(r.amount) || 0;
  const amount = Number(r.amount) || total;
  const paidAt = r.paid_at ?? (r.paid_date ? `${r.paid_date}T12:00:00.000Z` : null);

  return {
    id: r.id,
    number: r.number,
    client: r.client_name ?? "—",
    clientId: r.client_id,
    project: r.project ?? "—",
    projectId: r.project_id,
    amount,
    total,
    subtotal: Number(r.subtotal) || total,
    taxAmount: Number(r.tax_amount) || 0,
    amountPaid: Number(r.amount_paid) || 0,
    amountDue: Number(r.amount_due) || Math.max(total - Number(r.amount_paid || 0), 0),
    amountEur: r.amount_eur != null ? Number(r.amount_eur) : null,
    status: r.status,
    issueDate: r.issue_date,
    dueDate: r.due_date ?? r.issue_date,
    paidDate: r.paid_date ?? (paidAt ? paidAt.slice(0, 10) : null),
    paidAt: paidAt,
    paymentMethod: r.payment_method,
    lastReminder: r.last_reminder_at
      ? formatDistanceToNow(new Date(r.last_reminder_at), { addSuffix: true })
      : null,
    stripeStatus: r.stripe_status ?? "—",
    provider: r.provider ?? "manual",
    externalId: r.external_id,
    hostedInvoiceUrl: r.hosted_invoice_url ?? null,
    externalUrl: r.external_url ?? null,
    syncStatus: r.sync_status ?? "pending",
    currency: r.currency ?? "EUR",
    attentionDismissedAt: (r as InvoiceWithItems & { attention_dismissed_at?: string | null }).attention_dismissed_at ?? null,
    lineItems: r.line_items.map((li) => ({
      description: li.description,
      quantity: Number(li.quantity) || 1,
      unitAmount: Number(li.unit_amount) || Number(li.amount),
      amount: Number(li.line_total) || Number(li.amount),
    })),
  };
}

export type StripeInvoiceActionType =
  | "finalize"
  | "send"
  | "mark_paid_out_of_band"
  | "void"
  | "mark_uncollectible"
  | "delete_draft";

export interface InvoiceAction {
  id: string;
  label: string;
  stripeAction?: StripeInvoiceActionType;
  destructive?: boolean;
  disabled?: boolean;
}

export interface AvailableInvoiceActions {
  /** Full row overflow menu (non-destructive first, then destructive) */
  overflow: InvoiceAction[];
  /** Drawer / Needs Attention primary CTA */
  primary: InvoiceAction | null;
  /** Drawer secondary button */
  secondary: InvoiceAction | null;
  /** Drawer overflow menu (destructive / rare mutations) */
  drawerOverflow: InvoiceAction[];
}

function stripeAction(
  action: StripeInvoiceActionType,
  label: string,
  destructive = false,
): InvoiceAction {
  return { id: action, label, stripeAction: action, destructive };
}

function isStripeInvoice(inv: Invoice): boolean {
  return inv.provider === "stripe" && !!inv.externalId;
}

function stripeLifecycle(inv: Invoice): string {
  const ss = (inv.stripeStatus ?? "").toLowerCase();
  if (ss === "draft" || inv.status === "draft") return "draft";
  if (ss === "paid" || inv.status === "paid") return "paid";
  if (ss === "void") return "void";
  if (ss === "uncollectible") return "uncollectible";
  if (ss === "open" || ["sent", "viewed", "overdue", "partial"].includes(inv.status)) return "open";
  return ss || inv.status;
}

export function getAssignProjectLabel(inv: Invoice): string {
  return inv.projectId && inv.project !== "—" ? "Change project" : "Assign project";
}

function commonBrowseActions(inv: Invoice): InvoiceAction[] {
  const actions: InvoiceAction[] = [
    { id: "view", label: "View details" },
    { id: "assign_project", label: getAssignProjectLabel(inv) },
  ];
  if (inv.hostedInvoiceUrl) {
    actions.push({ id: "copy_link", label: "Copy payment link" });
    actions.push({ id: "download_pdf", label: "Download PDF" });
  } else {
    actions.push({ id: "download_pdf", label: "Download PDF", disabled: true });
  }
  if (isStripeInvoice(inv)) {
    actions.push({ id: "open_stripe", label: "Open in Stripe" });
  }
  return actions;
}

function stripeMutationActions(inv: Invoice): { normal: InvoiceAction[]; destructive: InvoiceAction[] } {
  const normal: InvoiceAction[] = [];
  const destructive: InvoiceAction[] = [];
  if (!isStripeInvoice(inv)) return { normal, destructive };

  const life = stripeLifecycle(inv);
  if (life === "draft") {
    normal.push(stripeAction("finalize", "Finalize"));
    normal.push(stripeAction("send", "Finalize and send"));
    destructive.push(stripeAction("delete_draft", "Delete draft", true));
  } else if (life === "open") {
    normal.push(stripeAction("send", "Send / resend invoice"));
    normal.push(stripeAction("mark_paid_out_of_band", "Mark paid outside Stripe"));
    destructive.push(stripeAction("mark_uncollectible", "Mark uncollectible", true));
    destructive.push(stripeAction("void", "Void invoice", true));
  } else if (life === "uncollectible") {
    normal.push(stripeAction("mark_paid_out_of_band", "Mark paid outside Stripe"));
    destructive.push(stripeAction("void", "Void invoice", true));
  }
  return { normal, destructive };
}

/** Single source of truth for invoice actions across table, drawer, and Needs Attention. */
export function getAvailableInvoiceActions(inv: Invoice): AvailableInvoiceActions {
  const browse = commonBrowseActions(inv);
  const { normal, destructive } = stripeMutationActions(inv);
  const life = stripeLifecycle(inv);

  const overflow = [...browse, ...normal, ...destructive];

  let primary: InvoiceAction | null = null;
  let secondary: InvoiceAction | null = null;
  let drawerOverflow: InvoiceAction[] = [];

  if (life === "draft" && isStripeInvoice(inv)) {
    primary = stripeAction("send", "Finalize and send");
    secondary = stripeAction("finalize", "Finalize");
    drawerOverflow = destructive;
  } else if (life === "open" && isStripeInvoice(inv)) {
    primary = stripeAction("send", "Send / resend invoice");
    secondary = stripeAction("mark_paid_out_of_band", "Mark paid outside Stripe");
    drawerOverflow = destructive;
  } else if (life === "uncollectible" && isStripeInvoice(inv)) {
    primary = stripeAction("mark_paid_out_of_band", "Mark paid outside Stripe");
    drawerOverflow = destructive;
  }

  return { overflow, primary, secondary, drawerOverflow };
}

/** @deprecated Use getAvailableInvoiceActions */
export function getInvoiceMenuActions(inv: Invoice): InvoiceAction[] {
  return getAvailableInvoiceActions(inv).overflow;
}

/** @deprecated Use getAvailableInvoiceActions */
export function getAttentionPrimaryAction(inv: Invoice): { label: string; action: StripeInvoiceActionType | "view" } {
  const { primary } = getAvailableInvoiceActions(inv);
  if (!primary?.stripeAction) return { label: "View invoice", action: "view" };
  return { label: primary.label, action: primary.stripeAction };
}

export function formatProviderLabel(provider: string): string {
  if (!provider || provider === "manual") return "Manual";
  if (provider === "stripe") return "Stripe";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function formatSyncBadge(syncStatus: string): { label: string; variant: StatusVariant } {
  const s = (syncStatus ?? "pending").toLowerCase();
  if (s === "synced") return { label: "Synced", variant: "success" };
  if (s === "failed" || s === "error") return { label: "Failed", variant: "danger" };
  if (s === "deleted") return { label: "Deleted", variant: "neutral" };
  return { label: "Pending", variant: "warning" };
}

export function formatPaymentTiming(avgDelayDays: number): {
  title: string;
  value: string;
  valueClassName?: string;
} {
  if (avgDelayDays === 0) {
    return { title: "Average payment timing", value: "On time", valueClassName: "text-success" };
  }
  if (avgDelayDays < 0) {
    return {
      title: "Average payment timing",
      value: `${Math.abs(avgDelayDays)} days early`,
      valueClassName: "text-success",
    };
  }
  return {
    title: "Average payment timing",
    value: `${avgDelayDays} days late`,
    valueClassName: "text-warning",
  };
}
