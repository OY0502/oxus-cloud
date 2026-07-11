import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  convertAmountToEur,
  getHistoricalRateToEur,
  invoiceFxReferenceDate,
} from "./frankfurterFx.ts";

export type FxBackfillResult = {
  fx_needed: number;
  fx_converted: number;
  fx_cached: number;
  fx_unavailable: number;
};

type InvoiceRow = {
  id: string;
  currency: string;
  total: number | null;
  amount: number | null;
  subtotal: number | null;
  tax_amount: number | null;
  amount_due: number | null;
  amount_paid: number | null;
  amount_eur: number | null;
  fx_status: string | null;
  issue_date: string;
  paid_date: string | null;
};

function isEur(currency: string): boolean {
  return (currency ?? "EUR").toUpperCase() === "EUR";
}

function nativeEurPatch(row: InvoiceRow) {
  const total = Number(row.total ?? row.amount ?? 0);
  const paid = Number(row.amount_paid ?? 0);
  const due = Number(row.amount_due ?? Math.max(total - paid, 0));
  const subtotal = Number(row.subtotal ?? total);
  const tax = Number(row.tax_amount ?? 0);
  const refDate = invoiceFxReferenceDate(row);
  return {
    amount_eur: total,
    amount_due_eur: due,
    amount_paid_eur: paid,
    subtotal_eur: subtotal,
    tax_amount_eur: tax,
    fx_status: "native_eur",
    fx_rate_to_eur: 1,
    fx_rate_date: refDate,
  };
}

function needsFxBackfill(row: InvoiceRow, force: boolean): boolean {
  if (isEur(row.currency)) return false;
  if (!force && row.fx_status === "converted" && row.amount_eur != null) return false;
  if (!force && row.fx_status === "native_eur") return false;
  return row.amount_eur == null
    || ["pending", "failed", "unavailable", null].includes(row.fx_status);
}

export async function backfillInvoiceFx(
  admin: SupabaseClient,
  options?: { force?: boolean; invoice_ids?: string[]; limit?: number },
): Promise<FxBackfillResult> {
  const result: FxBackfillResult = {
    fx_needed: 0,
    fx_converted: 0,
    fx_cached: 0,
    fx_unavailable: 0,
  };

  let query = admin
    .from("invoices")
    .select("id, currency, total, amount, subtotal, tax_amount, amount_due, amount_paid, amount_eur, fx_status, issue_date, paid_date");

  if (options?.invoice_ids?.length) {
    query = query.in("id", options.invoice_ids);
  }

  const { data: rows, error } = await query.limit(options?.limit ?? 500);
  if (error) throw new Error(error.message);

  const force = options?.force === true;

  for (const row of (rows ?? []) as InvoiceRow[]) {
    if (isEur(row.currency)) {
      const patch = nativeEurPatch(row);
      await admin.from("invoices").update(patch).eq("id", row.id);
      continue;
    }

    if (!needsFxBackfill(row, force)) continue;

    result.fx_needed += 1;

    const refDate = invoiceFxReferenceDate(row);
    const lookup = await getHistoricalRateToEur(admin, row.currency, refDate);

    if (!lookup) {
      result.fx_unavailable += 1;
      await admin.from("invoices").update({ fx_status: "unavailable" }).eq("id", row.id);
      continue;
    }

    if (lookup.cached) result.fx_cached += 1;

    const total = Number(row.total ?? row.amount ?? 0);
    const paid = Number(row.amount_paid ?? 0);
    const due = Number(row.amount_due ?? Math.max(total - paid, 0));
    const subtotal = Number(row.subtotal ?? total);
    const tax = Number(row.tax_amount ?? 0);

    await admin.from("invoices").update({
      amount_eur: convertAmountToEur(total, lookup.rate),
      amount_due_eur: convertAmountToEur(due, lookup.rate),
      amount_paid_eur: convertAmountToEur(paid, lookup.rate),
      subtotal_eur: convertAmountToEur(subtotal, lookup.rate),
      tax_amount_eur: convertAmountToEur(tax, lookup.rate),
      fx_status: "converted",
      fx_rate_to_eur: lookup.rate,
      fx_rate_date: lookup.rateDate,
    }).eq("id", row.id);

    result.fx_converted += 1;
  }

  return result;
}
