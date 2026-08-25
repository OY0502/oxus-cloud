/** Server-side mirror of src/lib/invoiceClassification.ts for Stripe sync and edge metrics. */

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
  provider?: string | null;
  sync_status?: string | null;
  due_date?: string | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  total?: number | null;
  amount?: number | null;
}

export interface InvoiceFinancialState {
  category: InvoiceFinancialCategory;
  isCollectible: boolean;
  countsTowardOutstanding: boolean;
  countsTowardOverdue: boolean;
  countsTowardDueSoon: boolean;
}

const DUE_SOON_DAYS = 7;

function normalizeFields(row: InvoiceClassificationFields) {
  return {
    status: String(row.status ?? "").toLowerCase(),
    stripeStatus: String(row.stripe_status ?? "").toLowerCase(),
    provider: String(row.provider ?? "manual").toLowerCase(),
    syncStatus: String(row.sync_status ?? "").toLowerCase(),
    dueDate: row.due_date ?? null,
    amountDue: row.amount_due != null ? Number(row.amount_due) : null,
    amountPaid: Number(row.amount_paid ?? 0),
    total: Number(row.total ?? row.amount ?? 0),
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

export function classifyInvoiceFinancialState(row: InvoiceClassificationFields): InvoiceFinancialState {
  const fields = normalizeFields(row);

  if (fields.syncStatus === "deleted") {
    return {
      category: "deleted",
      isCollectible: false,
      countsTowardOutstanding: false,
      countsTowardOverdue: false,
      countsTowardDueSoon: false,
    };
  }

  const stripeCategory = fields.provider === "stripe" ? stripeLifecycle(fields.stripeStatus) : null;

  if (stripeCategory === "paid" || fields.status === "paid") {
    return { category: "paid", isCollectible: false, countsTowardOutstanding: false, countsTowardOverdue: false, countsTowardDueSoon: false };
  }
  if (stripeCategory === "void" || fields.status === "void") {
    return { category: "void", isCollectible: false, countsTowardOutstanding: false, countsTowardOverdue: false, countsTowardDueSoon: false };
  }
  if (stripeCategory === "uncollectible" || fields.status === "uncollectible") {
    return { category: "uncollectible", isCollectible: false, countsTowardOutstanding: false, countsTowardOverdue: false, countsTowardDueSoon: false };
  }
  if (stripeCategory === "draft" || fields.status === "draft") {
    return { category: "draft", isCollectible: false, countsTowardOutstanding: false, countsTowardOverdue: false, countsTowardDueSoon: false };
  }

  const amountDue = effectiveAmountDue(fields);
  const daysUntilDue = computeDaysUntilDue(fields.dueDate);
  const isCollectible = amountDue > 0;

  if (!isCollectible) {
    return { category: fields.status === "partial" ? "partial" : "paid", isCollectible: false, countsTowardOutstanding: false, countsTowardOverdue: false, countsTowardDueSoon: false };
  }

  const isPastDue = daysUntilDue != null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue != null && daysUntilDue >= 0 && daysUntilDue <= DUE_SOON_DAYS;

  if (isPastDue || fields.status === "overdue") {
    return { category: "overdue", isCollectible: true, countsTowardOutstanding: true, countsTowardOverdue: true, countsTowardDueSoon: false };
  }
  if (isDueSoon) {
    return { category: "due_soon", isCollectible: true, countsTowardOutstanding: true, countsTowardOverdue: false, countsTowardDueSoon: true };
  }

  return { category: "open", isCollectible: true, countsTowardOutstanding: true, countsTowardOverdue: false, countsTowardDueSoon: false };
}

export function isOverdueReceivable(row: InvoiceClassificationFields): boolean {
  return classifyInvoiceFinancialState(row).countsTowardOverdue;
}

export function isOutstandingReceivable(row: InvoiceClassificationFields): boolean {
  return classifyInvoiceFinancialState(row).countsTowardOutstanding;
}
