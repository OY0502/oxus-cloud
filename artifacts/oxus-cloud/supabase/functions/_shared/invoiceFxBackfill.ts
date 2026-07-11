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
  fx_remaining: number;
  fx_batches: number;
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

const INVOICE_FX_SELECT =
  "id, currency, total, amount, subtotal, tax_amount, amount_due, amount_paid, amount_eur, fx_status, issue_date, paid_date";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 200;

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
  if (isEur(row.currency)) {
    return force || row.amount_eur == null || row.fx_status == null || row.fx_status !== "native_eur";
  }
  if (!force && row.fx_status === "converted" && row.amount_eur != null) return false;
  if (!force && row.fx_status === "native_eur") return false;
  return row.amount_eur == null
    || ["pending", "failed", "unavailable", null].includes(row.fx_status);
}

async function countNonEurNeedingFx(admin: SupabaseClient, force: boolean): Promise<number> {
  let query = admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .not("currency", "ilike", "EUR");
  if (!force) {
    query = query.or("amount_eur.is.null,fx_status.in.(pending,failed,unavailable),fx_status.is.null");
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countEurNeedingNative(admin: SupabaseClient, force: boolean): Promise<number> {
  if (!force) {
    const { count, error } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .ilike("currency", "EUR")
      .or("amount_eur.is.null,fx_status.is.null,fx_status.neq.native_eur");
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  return 0;
}

export async function countInvoicesNeedingFxBackfill(
  admin: SupabaseClient,
  force = false,
): Promise<number> {
  const [nonEur, eur] = await Promise.all([
    countNonEurNeedingFx(admin, force),
    countEurNeedingNative(admin, force),
  ]);
  return nonEur + eur;
}

async function fetchInvoicesNeedingFxBatch(
  admin: SupabaseClient,
  options: { force?: boolean; invoice_ids?: string[]; limit: number },
): Promise<InvoiceRow[]> {
  if (options.invoice_ids?.length) {
    const { data, error } = await admin
      .from("invoices")
      .select(INVOICE_FX_SELECT)
      .in("id", options.invoice_ids)
      .order("issue_date", { ascending: false })
      .limit(options.limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as InvoiceRow[];
  }

  const limit = options.limit;
  const force = options.force === true;
  const rows: InvoiceRow[] = [];

  let nonEurQuery = admin
    .from("invoices")
    .select(INVOICE_FX_SELECT)
    .not("currency", "ilike", "EUR");
  if (!force) {
    nonEurQuery = nonEurQuery.or("amount_eur.is.null,fx_status.in.(pending,failed,unavailable),fx_status.is.null");
  }
  const { data: nonEur, error: nonEurError } = await nonEurQuery
    .order("issue_date", { ascending: false })
    .limit(limit);
  if (nonEurError) throw new Error(nonEurError.message);
  rows.push(...((nonEur ?? []) as InvoiceRow[]));

  if (rows.length < limit) {
    let eurQuery = admin
      .from("invoices")
      .select(INVOICE_FX_SELECT)
      .ilike("currency", "EUR");
    if (!force) {
      eurQuery = eurQuery.or("amount_eur.is.null,fx_status.is.null,fx_status.neq.native_eur");
    }
    const { data: eurRows, error: eurError } = await eurQuery
      .order("issue_date", { ascending: false })
      .limit(limit - rows.length);
    if (eurError) throw new Error(eurError.message);
    rows.push(...((eurRows ?? []) as InvoiceRow[]));
  }

  return rows;
}

async function backfillInvoiceFxBatch(
  admin: SupabaseClient,
  options: { force?: boolean; invoice_ids?: string[]; limit: number },
): Promise<FxBackfillResult & { processed: number }> {
  const result: FxBackfillResult & { processed: number } = {
    fx_needed: 0,
    fx_converted: 0,
    fx_cached: 0,
    fx_unavailable: 0,
    fx_remaining: 0,
    fx_batches: 0,
    processed: 0,
  };

  const rows = await fetchInvoicesNeedingFxBatch(admin, options);
  const force = options.force === true;

  for (const row of rows) {
    if (!needsFxBackfill(row, force)) continue;

    result.processed += 1;

    if (isEur(row.currency)) {
      const patch = nativeEurPatch(row);
      await admin.from("invoices").update(patch).eq("id", row.id);
      continue;
    }

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

function mergeFxResults(target: FxBackfillResult, batch: FxBackfillResult & { processed: number }): void {
  target.fx_needed += batch.fx_needed;
  target.fx_converted += batch.fx_converted;
  target.fx_cached += batch.fx_cached;
  target.fx_unavailable += batch.fx_unavailable;
  target.fx_batches += 1;
}

export async function backfillInvoiceFx(
  admin: SupabaseClient,
  options?: {
    force?: boolean;
    invoice_ids?: string[];
    /** Max rows per batch (default 50). */
    limit?: number;
    /** Process every batch until no invoices need FX (default true). */
    all?: boolean;
    /** Safety cap on batch iterations (default 200). */
    max_batches?: number;
  },
): Promise<FxBackfillResult> {
  const result: FxBackfillResult = {
    fx_needed: 0,
    fx_converted: 0,
    fx_cached: 0,
    fx_unavailable: 0,
    fx_remaining: 0,
    fx_batches: 0,
  };

  const batchSize = options?.limit ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options?.max_batches ?? DEFAULT_MAX_BATCHES;
  const processAll = options?.all !== false;

  for (let i = 0; i < maxBatches; i++) {
    const batch = await backfillInvoiceFxBatch(admin, {
      force: options?.force,
      invoice_ids: options?.invoice_ids,
      limit: batchSize,
    });
    mergeFxResults(result, batch);

    if (!processAll) break;
    if (batch.processed === 0) break;
    if (options?.invoice_ids?.length) break;
  }

  result.fx_remaining = await countInvoicesNeedingFxBackfill(admin, options?.force === true);
  return result;
}
