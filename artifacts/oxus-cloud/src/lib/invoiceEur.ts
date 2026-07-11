import { formatEUR, EUR_UNAVAILABLE } from "@/lib/currency";
import type { InvoiceWithItems } from "@/lib/types";

export type FxStatus = "native_eur" | "converted" | "pending" | "failed" | "unavailable";

/** Minimal row shape for EUR reporting calculations. */
export interface InvoiceEurFields {
  currency: string;
  total?: number | null;
  amount?: number | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  amount_eur?: number | null;
  amount_due_eur?: number | null;
  amount_paid_eur?: number | null;
  fx_status?: string | null;
  fx_rate_date?: string | null;
}

/** Accept DB snake_case or UI camelCase invoice shapes. */
export function normalizeInvoiceEurFields(row: Record<string, unknown>): InvoiceEurFields {
  return {
    currency: String(row.currency ?? "EUR"),
    total: row.total != null ? Number(row.total) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    amount_due: row.amount_due != null ? Number(row.amount_due) : row.amountDue != null ? Number(row.amountDue) : null,
    amount_paid: row.amount_paid != null ? Number(row.amount_paid) : row.amountPaid != null ? Number(row.amountPaid) : null,
    amount_eur: row.amount_eur != null ? Number(row.amount_eur) : row.amountEur != null ? Number(row.amountEur) : null,
    amount_due_eur: row.amount_due_eur != null ? Number(row.amount_due_eur) : row.amountDueEur != null ? Number(row.amountDueEur) : null,
    amount_paid_eur: row.amount_paid_eur != null ? Number(row.amount_paid_eur) : row.amountPaidEur != null ? Number(row.amountPaidEur) : null,
    fx_status: (row.fx_status ?? row.fxStatus ?? null) as string | null,
    fx_rate_date: (row.fx_rate_date ?? row.fxRateDate ?? null) as string | null,
  };
}

export function isEurCurrency(currency: string | null | undefined): boolean {
  return (currency ?? "EUR").toUpperCase() === "EUR";
}

/** EUR total for reporting — null when conversion unavailable. */
export function invoiceTotalEur(row: InvoiceEurFields | Record<string, unknown>): number | null {
  const r = normalizeInvoiceEurFields(row as Record<string, unknown>);
  if (r.amount_eur != null && Number.isFinite(Number(r.amount_eur))) {
    return Number(r.amount_eur);
  }
  if (isEurCurrency(r.currency)) {
    return Number(r.total ?? r.amount ?? 0);
  }
  return null;
}

/** EUR balance due for outstanding metrics. */
export function invoiceAmountDueEur(row: InvoiceEurFields | Record<string, unknown>): number | null {
  const r = normalizeInvoiceEurFields(row as Record<string, unknown>);
  if (r.amount_due_eur != null && Number.isFinite(Number(r.amount_due_eur))) {
    return Number(r.amount_due_eur);
  }
  if (isEurCurrency(r.currency)) {
    const total = Number(r.total ?? r.amount ?? 0);
    const paid = Number(r.amount_paid ?? 0);
    return Number(r.amount_due) || Math.max(total - paid, 0);
  }
  const totalEur = invoiceTotalEur(r);
  if (totalEur == null) return null;
  const total = Number(r.total ?? r.amount ?? 0);
  const due = Number(r.amount_due) || Math.max(total - Number(r.amount_paid ?? 0), 0);
  if (total <= 0) return 0;
  return Math.round((due / total) * totalEur * 100) / 100;
}

/** EUR amount paid for revenue metrics. */
export function invoiceAmountPaidEur(row: InvoiceEurFields | Record<string, unknown>): number | null {
  const r = normalizeInvoiceEurFields(row as Record<string, unknown>);
  if (r.amount_paid_eur != null && Number.isFinite(Number(r.amount_paid_eur))) {
    return Number(r.amount_paid_eur);
  }
  if (isEurCurrency(r.currency)) {
    return Number(r.amount_paid ?? 0);
  }
  const totalEur = invoiceTotalEur(r);
  if (totalEur == null) return null;
  const total = Number(r.total ?? r.amount ?? 0);
  const paid = Number(r.amount_paid ?? 0);
  if (total <= 0) return 0;
  return Math.round((paid / total) * totalEur * 100) / 100;
}

export function invoiceMissingFxConversion(row: InvoiceEurFields | Record<string, unknown>): boolean {
  const r = normalizeInvoiceEurFields(row as Record<string, unknown>);
  if (isEurCurrency(r.currency)) return false;
  return invoiceTotalEur(r) == null;
}

export interface EurSumResult {
  total: number;
  missingFxCount: number;
}

/** Sum EUR values, excluding rows without conversion. */
export function sumInvoiceEur<T extends InvoiceEurFields | Record<string, unknown>>(
  rows: T[],
  picker: (row: T) => number | null,
): EurSumResult {
  let total = 0;
  let missingFxCount = 0;
  for (const row of rows) {
    const value = picker(row);
    if (value == null || !Number.isFinite(value)) {
      if (invoiceMissingFxConversion(row)) missingFxCount += 1;
      continue;
    }
    total += value;
  }
  return { total, missingFxCount };
}

export interface InvoiceEurDisplay {
  text: string;
  tooltip?: string;
  unavailable: boolean;
}

export function formatInvoiceEurDisplay(row: InvoiceEurFields | Record<string, unknown>): InvoiceEurDisplay {
  const r = normalizeInvoiceEurFields(row as Record<string, unknown>);
  const eur = invoiceTotalEur(r);
  if (eur != null) {
    const tooltip = !isEurCurrency(r.currency) && r.fx_rate_date
      ? `ECB reference rate from ${formatFxRateDate(r.fx_rate_date)}`
      : undefined;
    return { text: formatEUR(eur), tooltip, unavailable: false };
  }
  if (isEurCurrency(r.currency)) {
    return { text: formatEUR(Number(r.total ?? r.amount ?? 0)), unavailable: false };
  }
  return { text: EUR_UNAVAILABLE, unavailable: true };
}

function formatFxRateDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Count non-EUR invoices missing FX across a list. */
export function countMissingFxConversions(rows: Array<InvoiceEurFields | Record<string, unknown>>): number {
  return rows.filter(invoiceMissingFxConversion).length;
}

export type InvoiceEurRow = InvoiceWithItems;
