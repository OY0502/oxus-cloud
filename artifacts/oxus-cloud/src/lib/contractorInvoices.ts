import type { ContractorInvoice, ContractorInvoiceStatus } from "@/lib/types";

export const CONTRACTOR_INVOICE_STATUSES: ContractorInvoiceStatus[] = [
  "received",
  "approved",
  "partially_paid",
  "paid",
  "disputed",
  "cancelled",
];

export const CONTRACTOR_INVOICE_STATUS_LABELS: Record<ContractorInvoiceStatus, string> = {
  received: "Received",
  approved: "Approved",
  partially_paid: "Partially paid",
  paid: "Paid",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

export const CONTRACTOR_INVOICE_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  uploaded_file: "Uploaded file",
  wise: "Wise",
  email: "Email",
  other: "Other",
};

export function contractorInvoiceStatusVariant(
  status: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "paid") return "success";
  if (status === "approved" || status === "partially_paid") return "warning";
  if (status === "disputed" || status === "cancelled") return "danger";
  if (status === "received") return "info";
  return "neutral";
}

export function contractorInvoiceOutstanding(invoice: ContractorInvoice): number {
  return Math.max(0, Number(invoice.total) - Number(invoice.paid_amount));
}

export function formatInvoicePeriod(invoice: ContractorInvoice): string {
  if (invoice.period_start && invoice.period_end) {
    return `${invoice.period_start} – ${invoice.period_end}`;
  }
  if (invoice.period_start) return `From ${invoice.period_start}`;
  if (invoice.period_end) return `Until ${invoice.period_end}`;
  return "—";
}

export function isOpenContractorInvoice(invoice: ContractorInvoice): boolean {
  return ["received", "approved", "partially_paid"].includes(invoice.status);
}
