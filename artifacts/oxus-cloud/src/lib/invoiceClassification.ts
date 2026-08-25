import { invoiceAmountDueEur, sumInvoiceEur } from "@/lib/invoiceEur";

export type InvoiceFinancialCategory =
  | "paid"
  | "draft"
  | "void"
  | "uncollectible"
  | "deleted"
  | "overdue"
  | "due_soon"
  | "open"
  | "partial";

export interface InvoiceClassificationFields {
  status?: string | null;
  stripe_status?: string | null;
  stripeStatus?: string | null;
  provider?: string | null;
  sync_status?: string | null;
  syncStatus?: string | null;
  due_date?: string | null;
  dueDate?: string | null;
  amount_due?: number | null;
  amountDue?: number | null;
  amount_paid?: number | null;
  amountPaid?: number | null;
  total?: number | null;
  amount?: number | null;
  attention_dismissed_at?: string | null;
  attentionDismissedAt?: string | null;
}

export interface InvoiceFinancialState {
  category: InvoiceFinancialCategory;
  isCollectible: boolean;
  countsTowardOutstanding: boolean;
  countsTowardOverdue: boolean;
  countsTowardDueSoon: boolean;
  needsAttention: boolean;
  amountDueEur: number | null;
  daysUntilDue: number | null;
  daysOverdue: number | null;
}

const DUE_SOON_DAYS = 7;

function normalizeFields(row: InvoiceClassificationFields) {
  return {
    status: String(row.status ?? "").toLowerCase(),
    stripeStatus: String(row.stripe_status ?? row.stripeStatus ?? "").toLowerCase(),
    provider: String(row.provider ?? "manual").toLowerCase(),
    syncStatus: String(row.sync_status ?? row.syncStatus ?? "").toLowerCase(),
    dueDate: row.due_date ?? row.dueDate ?? null,
    amountDue: row.amount_due != null ? Number(row.amount_due) : row.amountDue != null ? Number(row.amountDue) : null,
    amountPaid: Number(row.amount_paid ?? row.amountPaid ?? 0),
    total: Number(row.total ?? row.amount ?? 0),
    attentionDismissedAt: row.attention_dismissed_at ?? row.attentionDismissedAt ?? null,
  };
}

function effectiveAmountDue(fields: ReturnType<typeof normalizeFields>): number {
  if (fields.amountDue != null && Number.isFinite(fields.amountDue)) {
    return Math.max(fields.amountDue, 0);
  }
  return Math.max(fields.total - fields.amountPaid, 0);
}

function computeDaysUntilDue(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function stripeLifecycle(stripeStatus: string): InvoiceFinancialCategory | null {
  switch (stripeStatus) {
    case "paid":
      return "paid";
    case "void":
    case "deleted":
      return "void";
    case "uncollectible":
      return "uncollectible";
    case "draft":
      return "draft";
    case "open":
      return null;
    default:
      return null;
  }
}

function terminalState(
  fields: ReturnType<typeof normalizeFields>,
): InvoiceFinancialState | null {
  const amountDueEur = invoiceAmountDueEur(fields);
  const daysUntilDue = computeDaysUntilDue(fields.dueDate);
  const daysOverdue = daysUntilDue != null && daysUntilDue < 0 ? Math.abs(daysUntilDue) : null;
  const dismissed = !!fields.attentionDismissedAt;

  if (fields.syncStatus === "deleted") {
    return {
      category: "deleted",
      isCollectible: false,
      countsTowardOutstanding: false,
      countsTowardOverdue: false,
      countsTowardDueSoon: false,
      needsAttention: false,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  const stripeCategory = fields.provider === "stripe" ? stripeLifecycle(fields.stripeStatus) : null;
  if (stripeCategory === "paid" || fields.status === "paid") {
    return {
      category: "paid",
      isCollectible: false,
      countsTowardOutstanding: false,
      countsTowardOverdue: false,
      countsTowardDueSoon: false,
      needsAttention: false,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  if (stripeCategory === "void" || fields.status === "void") {
    return {
      category: "void",
      isCollectible: false,
      countsTowardOutstanding: false,
      countsTowardOverdue: false,
      countsTowardDueSoon: false,
      needsAttention: false,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  if (stripeCategory === "uncollectible" || fields.status === "uncollectible") {
    return {
      category: "uncollectible",
      isCollectible: false,
      countsTowardOutstanding: false,
      countsTowardOverdue: false,
      countsTowardDueSoon: false,
      needsAttention: false,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  if (stripeCategory === "draft" || fields.status === "draft") {
    return {
      category: "draft",
      isCollectible: false,
      countsTowardOutstanding: false,
      countsTowardOverdue: false,
      countsTowardDueSoon: false,
      needsAttention: !dismissed,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  return null;
}

/** Single source of truth for invoice financial classification across KPIs, filters, and attention logic. */
export function classifyInvoiceFinancialState(row: InvoiceClassificationFields): InvoiceFinancialState {
  const fields = normalizeFields(row);
  const terminal = terminalState(fields);
  if (terminal) return terminal;

  const amountDue = effectiveAmountDue(fields);
  const amountDueEur = invoiceAmountDueEur(fields);
  const daysUntilDue = computeDaysUntilDue(fields.dueDate);
  const daysOverdue = daysUntilDue != null && daysUntilDue < 0 ? Math.abs(daysUntilDue) : null;
  const dismissed = !!fields.attentionDismissedAt;
  const isCollectible = amountDue > 0;

  if (!isCollectible) {
    return {
      category: fields.status === "partial" ? "partial" : "paid",
      isCollectible: false,
      countsTowardOutstanding: false,
      countsTowardOverdue: false,
      countsTowardDueSoon: false,
      needsAttention: false,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  const isPastDue = daysUntilDue != null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue != null && daysUntilDue >= 0 && daysUntilDue <= DUE_SOON_DAYS;
  const isPartial = fields.status === "partial" || (fields.amountPaid > 0 && amountDue < fields.total);

  if (isPastDue || fields.status === "overdue") {
    return {
      category: "overdue",
      isCollectible: true,
      countsTowardOutstanding: true,
      countsTowardOverdue: true,
      countsTowardDueSoon: false,
      needsAttention: !dismissed,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  if (isDueSoon) {
    return {
      category: isPartial ? "partial" : "due_soon",
      isCollectible: true,
      countsTowardOutstanding: true,
      countsTowardOverdue: false,
      countsTowardDueSoon: true,
      needsAttention: !dismissed,
      amountDueEur,
      daysUntilDue,
      daysOverdue,
    };
  }

  return {
    category: isPartial ? "partial" : "open",
    isCollectible: true,
    countsTowardOutstanding: true,
    countsTowardOverdue: false,
    countsTowardDueSoon: false,
    needsAttention: false,
    amountDueEur,
    daysUntilDue,
    daysOverdue,
  };
}

export function isOverdueReceivable(row: InvoiceClassificationFields): boolean {
  return classifyInvoiceFinancialState(row).countsTowardOverdue;
}

export function isOutstandingReceivable(row: InvoiceClassificationFields): boolean {
  return classifyInvoiceFinancialState(row).countsTowardOutstanding;
}

export function isDueSoonReceivable(row: InvoiceClassificationFields, withinDays = DUE_SOON_DAYS): boolean {
  const state = classifyInvoiceFinancialState(row);
  if (!state.countsTowardDueSoon) return false;
  return state.daysUntilDue != null && state.daysUntilDue >= 0 && state.daysUntilDue <= withinDays;
}

export function invoiceNeedsAttention(row: InvoiceClassificationFields): boolean {
  return classifyInvoiceFinancialState(row).needsAttention;
}

export function sumOverdueReceivablesEur<T extends InvoiceClassificationFields>(rows: T[]) {
  return sumInvoiceEur(
    rows.filter(isOverdueReceivable) as (import("@/lib/invoiceEur").InvoiceEurFields | Record<string, unknown>)[],
    (row) => classifyInvoiceFinancialState(row).amountDueEur,
  );
}

export function sumOutstandingReceivablesEur<T extends InvoiceClassificationFields>(rows: T[]) {
  return sumInvoiceEur(
    rows.filter(isOutstandingReceivable) as (import("@/lib/invoiceEur").InvoiceEurFields | Record<string, unknown>)[],
    (row) => classifyInvoiceFinancialState(row).amountDueEur,
  );
}

export function sumDueSoonReceivablesEur<T extends InvoiceClassificationFields>(rows: T[], withinDays = DUE_SOON_DAYS) {
  return sumInvoiceEur(
    rows.filter((row) => isDueSoonReceivable(row, withinDays)) as (import("@/lib/invoiceEur").InvoiceEurFields | Record<string, unknown>)[],
    (row) => classifyInvoiceFinancialState(row).amountDueEur,
  );
}

export function financialCategoryLabel(category: InvoiceFinancialCategory): string {
  switch (category) {
    case "overdue":
      return "Overdue";
    case "due_soon":
      return "Due soon";
    case "open":
      return "Open";
    case "partial":
      return "Partially paid";
    case "uncollectible":
      return "Uncollectible";
    case "void":
      return "Void";
    case "draft":
      return "Draft";
    case "paid":
      return "Paid";
    case "deleted":
      return "Deleted";
    default:
      return category;
  }
}
