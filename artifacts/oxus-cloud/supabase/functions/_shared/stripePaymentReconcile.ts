import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";
import {
  convertAmountToEur,
  getHistoricalRateToEur,
  invoiceFxReferenceDate,
} from "./frankfurterFx.ts";

export const REPORTING_TIMEZONE = "Europe/Lisbon";

export type AmountBasis =
  | "stripe_actual_settlement"
  | "native_eur"
  | "ecb_reference"
  | "paid_out_of_band_reference"
  | "unavailable";

export type ReconcilePaymentsResult = {
  payments_checked: number;
  payments_reconciled_actual: number;
  payments_reconciled_reference: number;
  payments_paid_out_of_band: number;
  payments_unresolved: number;
  gross_eur_minor: number;
  stripe_fees_eur_minor: number;
  net_eur_minor: number;
  warnings: string[];
};

type DbInvoice = {
  id: string;
  number: string;
  external_id: string | null;
  provider: string | null;
  status: string;
  currency: string;
  total: number | null;
  amount: number | null;
  amount_paid: number | null;
  issue_date: string;
  paid_date: string | null;
  paid_at: string | null;
  client_name: string | null;
};

type InvoicePaymentLike = {
  id: string;
  status: string;
  amount_paid: number;
  currency: string;
  status_transitions?: { paid_at?: number | null };
  payment?: {
    type?: string;
    payment_intent?: string;
    charge?: string;
  };
};

type StripeWithInvoicePayments = Stripe & {
  invoicePayments?: {
    list: (params: {
      invoice: string;
      status?: string;
      limit?: number;
      starting_after?: string;
    }) => Promise<Stripe.ApiList<InvoicePaymentLike>>;
  };
};

type ReconciliationRow = {
  invoice_id: string;
  provider: string;
  external_invoice_payment_id: string | null;
  external_payment_intent_id: string | null;
  external_charge_id: string | null;
  external_balance_transaction_id: string | null;
  payment_type: string | null;
  paid_at: string;
  reporting_month: string;
  original_currency: string;
  original_amount_minor: number;
  settlement_currency: string | null;
  settlement_gross_minor: number | null;
  stripe_fee_minor: number | null;
  settlement_net_minor: number | null;
  stripe_exchange_rate: number | null;
  reference_rate_to_eur: number | null;
  reference_rate_date: string | null;
  reference_eur_minor: number | null;
  gross_eur_minor: number | null;
  stripe_fee_eur_minor: number | null;
  net_eur_minor: number | null;
  amount_basis: AmountBasis;
  is_paid_out_of_band: boolean;
  fee_details: unknown[];
  sync_status: string;
  sync_error: string | null;
  metadata: Record<string, unknown>;
  last_synced_at: string;
};

function roundMinorFromMajor(amount: number): number {
  return Math.round(amount * 100);
}

function toIsoFromUnix(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

function monthBounds(month?: string): { monthKey: string; startIso: string; endIso: string } {
  const now = new Date();
  let monthKey = month?.trim();
  if (!monthKey) {
    monthKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORTING_TIMEZONE,
      year: "numeric",
      month: "2-digit",
    }).format(now).slice(0, 7);
  }
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0));
  // Approximate bounds; reporting_month generated column is authoritative for filtering.
  return { monthKey, startIso: start.toISOString(), endIso: end.toISOString() };
}

export function reportingMonthFromPaidAt(paidAtIso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(paidAtIso)).slice(0, 7);
}

async function listPaidInvoicePayments(
  stripe: Stripe,
  stripeInvoiceId: string,
): Promise<InvoicePaymentLike[]> {
  const client = stripe as StripeWithInvoicePayments;
  if (client.invoicePayments?.list) {
    const all: InvoicePaymentLike[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const page = await client.invoicePayments.list({
        invoice: stripeInvoiceId,
        status: "paid",
        limit: 100,
        starting_after: startingAfter,
      });
      all.push(...page.data);
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1]?.id;
    }
    return all;
  }

  const resp = await fetch(
    `https://api.stripe.com/v1/invoice_payments?invoice=${encodeURIComponent(stripeInvoiceId)}&status=paid&limit=100`,
    {
      headers: {
        Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,
        "Stripe-Version": Deno.env.get("STRIPE_API_VERSION")?.trim() || "2025-02-24.acacia",
      },
    },
  );
  if (!resp.ok) {
    console.warn("[stripePaymentReconcile] invoice_payments list failed", resp.status);
    return [];
  }
  const body = await resp.json() as { data?: InvoicePaymentLike[] };
  return body.data ?? [];
}

async function resolveCharge(
  stripe: Stripe,
  payment: InvoicePaymentLike["payment"],
): Promise<Stripe.Charge | null> {
  if (!payment) return null;
  if (payment.type === "charge" && payment.charge) {
    return stripe.charges.retrieve(payment.charge);
  }
  if (payment.type === "payment_intent" && payment.payment_intent) {
    const pi = await stripe.paymentIntents.retrieve(payment.payment_intent, {
      expand: ["latest_charge"],
    });
    const charge = pi.latest_charge;
    if (!charge) return null;
    if (typeof charge === "string") return stripe.charges.retrieve(charge);
    return charge;
  }
  return null;
}

async function resolveBalanceTransaction(
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<Stripe.BalanceTransaction | null> {
  const btId = typeof charge.balance_transaction === "string"
    ? charge.balance_transaction
    : charge.balance_transaction?.id;
  if (!btId) return null;
  return stripe.balanceTransactions.retrieve(btId);
}

function mapFeeDetails(bt: Stripe.BalanceTransaction | null): unknown[] {
  return (bt?.fee_details ?? []).map((fd) => ({
    amount: fd.amount,
    currency: fd.currency,
    type: fd.type,
    description: fd.description ?? null,
    application: fd.application ?? null,
  }));
}

function convertMinorToEurUsingRate(minor: number, rate: number): number {
  return Math.round((minor / 100) * rate * 100);
}

async function buildReferenceEur(
  admin: SupabaseClient,
  invoice: DbInvoice,
  originalMinor: number,
  originalCurrency: string,
): Promise<{
  reference_rate_to_eur: number | null;
  reference_rate_date: string | null;
  reference_eur_minor: number | null;
}> {
  const currency = originalCurrency.toUpperCase();
  if (currency === "EUR") {
    return {
      reference_rate_to_eur: 1,
      reference_rate_date: invoiceFxReferenceDate(invoice).slice(0, 10),
      reference_eur_minor: originalMinor,
    };
  }
  const refDate = invoiceFxReferenceDate(invoice).slice(0, 10);
  const lookup = await getHistoricalRateToEur(admin, currency, refDate);
  if (!lookup) {
    return { reference_rate_to_eur: null, reference_rate_date: refDate, reference_eur_minor: null };
  }
  return {
    reference_rate_to_eur: lookup.rate,
    reference_rate_date: lookup.rateDate,
    reference_eur_minor: convertMinorToEurUsingRate(originalMinor, lookup.rate),
  };
}

function deriveEurFromSettlement(
  settlementCurrency: string | null,
  settlementGrossMinor: number | null,
  settlementFeeMinor: number | null,
  settlementNetMinor: number | null,
  stripeExchangeRate: number | null,
  referenceEurMinor: number | null,
  referenceRate: number | null,
): {
  gross_eur_minor: number | null;
  stripe_fee_eur_minor: number | null;
  net_eur_minor: number | null;
  amount_basis: AmountBasis;
} {
  const settlement = (settlementCurrency ?? "").toUpperCase();
  if (settlement === "EUR" && settlementGrossMinor != null) {
    return {
      gross_eur_minor: settlementGrossMinor,
      stripe_fee_eur_minor: settlementFeeMinor ?? 0,
      net_eur_minor: settlementNetMinor ?? (settlementGrossMinor - (settlementFeeMinor ?? 0)),
      amount_basis: "stripe_actual_settlement",
    };
  }
  if (referenceEurMinor != null && referenceRate != null) {
    const grossMajor = referenceEurMinor / 100;
    const feeMajor = settlementFeeMinor != null && stripeExchangeRate
      ? convertAmountToEur((settlementFeeMinor ?? 0) / 100, stripeExchangeRate)
      : settlementFeeMinor != null && referenceRate
        ? convertAmountToEur((settlementFeeMinor ?? 0) / 100, referenceRate)
        : 0;
    const feeMinor = Math.round(feeMajor * 100);
    return {
      gross_eur_minor: referenceEurMinor,
      stripe_fee_eur_minor: feeMinor,
      net_eur_minor: referenceEurMinor - feeMinor,
      amount_basis: settlementGrossMinor != null ? "ecb_reference" : "ecb_reference",
    };
  }
  return {
    gross_eur_minor: null,
    stripe_fee_eur_minor: null,
    net_eur_minor: null,
    amount_basis: "unavailable",
  };
}

async function upsertReconciliationRow(
  admin: SupabaseClient,
  row: ReconciliationRow,
): Promise<void> {
  let existingId: string | null = null;

  if (row.external_invoice_payment_id) {
    const { data } = await admin
      .from("invoice_payment_reconciliations")
      .select("id")
      .eq("invoice_id", row.invoice_id)
      .eq("external_invoice_payment_id", row.external_invoice_payment_id)
      .maybeSingle();
    existingId = data?.id ?? null;
  } else if (row.external_charge_id) {
    const { data } = await admin
      .from("invoice_payment_reconciliations")
      .select("id")
      .eq("invoice_id", row.invoice_id)
      .eq("external_charge_id", row.external_charge_id)
      .maybeSingle();
    existingId = data?.id ?? null;
  } else if (row.is_paid_out_of_band) {
    const { data } = await admin
      .from("invoice_payment_reconciliations")
      .select("id")
      .eq("invoice_id", row.invoice_id)
      .eq("is_paid_out_of_band", true)
      .maybeSingle();
    existingId = data?.id ?? null;
  }

  if (existingId) {
    const { error } = await admin.from("invoice_payment_reconciliations").update(row).eq("id", existingId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await admin.from("invoice_payment_reconciliations").insert(row);
  if (error) throw new Error(error.message);
}

async function reconcileOutOfBandPayment(
  admin: SupabaseClient,
  invoice: DbInvoice,
  stripeInvoice: Stripe.Invoice,
): Promise<ReconciliationRow> {
  const paidAt = toIsoFromUnix(stripeInvoice.status_transitions?.paid_at)
    ?? invoice.paid_at
    ?? `${invoice.paid_date ?? invoice.issue_date}T12:00:00.000Z`;
  const originalMinor = stripeInvoice.amount_paid ?? roundMinorFromMajor(Number(invoice.amount_paid ?? invoice.total ?? 0));
  const originalCurrency = (stripeInvoice.currency ?? invoice.currency ?? "EUR").toUpperCase();
  const reference = await buildReferenceEur(admin, invoice, originalMinor, originalCurrency);
  const isEur = originalCurrency === "EUR";

  return {
    invoice_id: invoice.id,
    provider: "stripe",
    external_invoice_payment_id: null,
    external_payment_intent_id: null,
    external_charge_id: null,
    external_balance_transaction_id: null,
    payment_type: "paid_out_of_band",
    paid_at: paidAt,
    reporting_month: reportingMonthFromPaidAt(paidAt),
    original_currency: originalCurrency,
    original_amount_minor: originalMinor,
    settlement_currency: isEur ? "EUR" : originalCurrency,
    settlement_gross_minor: originalMinor,
    stripe_fee_minor: 0,
    settlement_net_minor: originalMinor,
    stripe_exchange_rate: isEur ? 1 : null,
    reference_rate_to_eur: reference.reference_rate_to_eur,
    reference_rate_date: reference.reference_rate_date,
    reference_eur_minor: reference.reference_eur_minor,
    gross_eur_minor: isEur ? originalMinor : reference.reference_eur_minor,
    stripe_fee_eur_minor: 0,
    net_eur_minor: isEur ? originalMinor : reference.reference_eur_minor,
    amount_basis: isEur ? "native_eur" : "paid_out_of_band_reference",
    is_paid_out_of_band: true,
    fee_details: [],
    sync_status: reference.reference_eur_minor != null || isEur ? "synced" : "partial",
    sync_error: null,
    metadata: { source: "stripe_invoice_paid_out_of_band" },
    last_synced_at: new Date().toISOString(),
  };
}

async function reconcileInvoicePaymentRecord(
  admin: SupabaseClient,
  stripe: Stripe,
  invoice: DbInvoice,
  payment: InvoicePaymentLike,
): Promise<ReconciliationRow> {
  const paidAt = toIsoFromUnix(payment.status_transitions?.paid_at)
    ?? invoice.paid_at
    ?? `${invoice.paid_date ?? invoice.issue_date}T12:00:00.000Z`;
  const originalMinor = payment.amount_paid;
  const originalCurrency = (payment.currency ?? invoice.currency ?? "EUR").toUpperCase();

  let charge: Stripe.Charge | null = null;
  let balanceTx: Stripe.BalanceTransaction | null = null;
  let syncError: string | null = null;

  try {
    charge = await resolveCharge(stripe, payment.payment);
    if (charge) balanceTx = await resolveBalanceTransaction(stripe, charge);
  } catch (e) {
    syncError = (e as Error).message;
  }

  const reference = await buildReferenceEur(admin, invoice, originalMinor, originalCurrency);
  const settlementCurrency = balanceTx?.currency?.toUpperCase() ?? (originalCurrency === "EUR" ? "EUR" : null);
  const settlementGrossMinor = balanceTx?.amount ?? (originalCurrency === "EUR" ? originalMinor : null);
  const settlementFeeMinor = balanceTx?.fee ?? null;
  const settlementNetMinor = balanceTx?.net ?? null;
  const stripeExchangeRate = balanceTx?.exchange_rate ?? null;

  let amountBasis: AmountBasis = "unavailable";
  let grossEurMinor: number | null = null;
  let feeEurMinor: number | null = null;
  let netEurMinor: number | null = null;

  if (originalCurrency === "EUR" && settlementCurrency === "EUR" && settlementGrossMinor != null) {
    amountBasis = "native_eur";
    grossEurMinor = settlementGrossMinor;
    feeEurMinor = settlementFeeMinor ?? 0;
    netEurMinor = settlementNetMinor ?? (settlementGrossMinor - (settlementFeeMinor ?? 0));
  } else if (settlementCurrency === "EUR" && settlementGrossMinor != null) {
    amountBasis = "stripe_actual_settlement";
    grossEurMinor = settlementGrossMinor;
    feeEurMinor = settlementFeeMinor ?? 0;
    netEurMinor = settlementNetMinor ?? (settlementGrossMinor - (settlementFeeMinor ?? 0));
  } else {
    const derived = deriveEurFromSettlement(
      settlementCurrency,
      settlementGrossMinor,
      settlementFeeMinor,
      settlementNetMinor,
      stripeExchangeRate,
      reference.reference_eur_minor,
      reference.reference_rate_to_eur,
    );
    amountBasis = derived.amount_basis;
    grossEurMinor = derived.gross_eur_minor;
    feeEurMinor = derived.stripe_fee_eur_minor;
    netEurMinor = derived.net_eur_minor;
  }

  return {
    invoice_id: invoice.id,
    provider: "stripe",
    external_invoice_payment_id: payment.id,
    external_payment_intent_id: payment.payment?.payment_intent ?? null,
    external_charge_id: charge?.id ?? payment.payment?.charge ?? null,
    external_balance_transaction_id: balanceTx?.id ?? null,
    payment_type: payment.payment?.type ?? null,
    paid_at: paidAt,
    reporting_month: reportingMonthFromPaidAt(paidAt),
    original_currency: originalCurrency,
    original_amount_minor: originalMinor,
    settlement_currency: settlementCurrency,
    settlement_gross_minor: settlementGrossMinor,
    stripe_fee_minor: settlementFeeMinor,
    settlement_net_minor: settlementNetMinor,
    stripe_exchange_rate: stripeExchangeRate,
    reference_rate_to_eur: reference.reference_rate_to_eur,
    reference_rate_date: reference.reference_rate_date,
    reference_eur_minor: reference.reference_eur_minor,
    gross_eur_minor: grossEurMinor,
    stripe_fee_eur_minor: feeEurMinor,
    net_eur_minor: netEurMinor,
    amount_basis: amountBasis,
    is_paid_out_of_band: false,
    fee_details: mapFeeDetails(balanceTx),
    sync_status: grossEurMinor != null ? (syncError ? "partial" : "synced") : "unavailable",
    sync_error: syncError,
    metadata: {
      charge_status: charge?.status ?? null,
      balance_tx_type: balanceTx?.type ?? null,
    },
    last_synced_at: new Date().toISOString(),
  };
}

async function reconcileLegacyPaymentIntent(
  admin: SupabaseClient,
  stripe: Stripe,
  invoice: DbInvoice,
  stripeInvoice: Stripe.Invoice,
): Promise<ReconciliationRow | null> {
  const piId = typeof stripeInvoice.payment_intent === "string"
    ? stripeInvoice.payment_intent
    : stripeInvoice.payment_intent?.id;
  if (!piId) return null;

  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
  if (pi.status !== "succeeded") return null;

  const charge = typeof pi.latest_charge === "string"
    ? await stripe.charges.retrieve(pi.latest_charge)
    : pi.latest_charge;
  if (!charge) return null;

  const fakePayment: InvoicePaymentLike = {
    id: `legacy_pi_${pi.id}`,
    status: "paid",
    amount_paid: charge.amount,
    currency: charge.currency,
    status_transitions: { paid_at: charge.created },
    payment: { type: "payment_intent", payment_intent: pi.id },
  };
  return reconcileInvoicePaymentRecord(admin, stripe, invoice, fakePayment);
}

export async function reconcileStripeInvoice(
  admin: SupabaseClient,
  stripe: Stripe,
  invoice: DbInvoice,
): Promise<ReconciliationRow[]> {
  if (invoice.provider !== "stripe" || invoice.status !== "paid" || !invoice.external_id) {
    return [];
  }

  const stripeInvoice = await stripe.invoices.retrieve(invoice.external_id);
  const rows: ReconciliationRow[] = [];

  if (stripeInvoice.paid_out_of_band) {
    const row = await reconcileOutOfBandPayment(admin, invoice, stripeInvoice);
    await upsertReconciliationRow(admin, row);
    rows.push(row);
    return rows;
  }

  const payments = await listPaidInvoicePayments(stripe, invoice.external_id);
  if (payments.length === 0) {
    const legacy = await reconcileLegacyPaymentIntent(admin, stripe, invoice, stripeInvoice);
    if (legacy) {
      await upsertReconciliationRow(admin, legacy);
      rows.push(legacy);
    }
    return rows;
  }

  for (const payment of payments) {
    try {
      const row = await reconcileInvoicePaymentRecord(admin, stripe, invoice, payment);
      await upsertReconciliationRow(admin, row);
      rows.push(row);
    } catch (e) {
      console.warn(`[stripePaymentReconcile] payment ${payment.id} failed:`, (e as Error).message);
    }
  }

  return rows;
}

async function loadInvoicesForReconciliation(
  admin: SupabaseClient,
  options: { invoice_id?: string; month?: string; limit?: number },
): Promise<DbInvoice[]> {
  if (options.invoice_id) {
    const { data, error } = await admin
      .from("invoices")
      .select("id, number, external_id, provider, status, currency, total, amount, amount_paid, issue_date, paid_date, paid_at, client_name")
      .eq("id", options.invoice_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? [data as DbInvoice] : [];
  }

  const { monthKey } = monthBounds(options.month);
  const [yearStr, monStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monStr);
  const lastDay = new Date(year, month, 0).getDate();
  const paidDateStart = `${monthKey}-01`;
  const paidDateEnd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  const { data, error } = await admin
    .from("invoices")
    .select("id, number, external_id, provider, status, currency, total, amount, amount_paid, issue_date, paid_date, paid_at, client_name")
    .eq("provider", "stripe")
    .eq("status", "paid")
    .not("external_id", "is", null)
    .gte("paid_date", paidDateStart)
    .lte("paid_date", paidDateEnd)
    .order("paid_date", { ascending: false })
    .limit(options.limit ?? 200);
  if (error) throw new Error(error.message);
  return (data ?? []) as DbInvoice[];
}

function summarizeRows(rows: ReconciliationRow[]): Pick<
  ReconcilePaymentsResult,
  "payments_reconciled_actual" | "payments_reconciled_reference" | "payments_paid_out_of_band" | "payments_unresolved" | "gross_eur_minor" | "stripe_fees_eur_minor" | "net_eur_minor"
> {
  let payments_reconciled_actual = 0;
  let payments_reconciled_reference = 0;
  let payments_paid_out_of_band = 0;
  let payments_unresolved = 0;
  let gross_eur_minor = 0;
  let stripe_fees_eur_minor = 0;
  let net_eur_minor = 0;

  for (const row of rows) {
    if (row.is_paid_out_of_band) payments_paid_out_of_band += 1;
    else if (row.amount_basis === "stripe_actual_settlement" || row.amount_basis === "native_eur") {
      payments_reconciled_actual += 1;
    } else if (row.amount_basis === "ecb_reference" || row.amount_basis === "paid_out_of_band_reference") {
      payments_reconciled_reference += 1;
    } else {
      payments_unresolved += 1;
    }

    if (row.gross_eur_minor != null) gross_eur_minor += row.gross_eur_minor;
    if (row.stripe_fee_eur_minor != null) stripe_fees_eur_minor += row.stripe_fee_eur_minor;
    if (row.net_eur_minor != null) net_eur_minor += row.net_eur_minor;
  }

  return {
    payments_reconciled_actual,
    payments_reconciled_reference,
    payments_paid_out_of_band,
    payments_unresolved,
    gross_eur_minor,
    stripe_fees_eur_minor,
    net_eur_minor,
  };
}

export async function reconcileStripeInvoicePayments(
  admin: SupabaseClient,
  stripe: Stripe,
  options?: { invoice_id?: string; month?: string; force?: boolean; limit?: number },
): Promise<ReconcilePaymentsResult> {
  const warnings: string[] = [];
  const invoices = await loadInvoicesForReconciliation(admin, options);
  const allRows: ReconciliationRow[] = [];

  const concurrency = 3;
  for (let i = 0; i < invoices.length; i += concurrency) {
    const batch = invoices.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((inv) => reconcileStripeInvoice(admin, stripe, inv)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        allRows.push(...result.value);
      } else {
        warnings.push(result.reason?.message ?? "Unknown reconciliation error");
      }
    }
  }

  const summary = summarizeRows(allRows);
  return {
    payments_checked: allRows.length,
    warnings,
    ...summary,
  };
}

export async function aggregateReconciliationMonth(
  admin: SupabaseClient,
  month?: string,
): Promise<ReconcilePaymentsResult & { reporting_month: string; last_reconciled_at: string | null }> {
  const { monthKey } = monthBounds(month);
  const { data, error } = await admin
    .from("invoice_payment_reconciliations")
    .select("*")
    .eq("reporting_month", monthKey);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ReconciliationRow[];
  const summary = summarizeRows(rows);
  const last = rows.reduce<string | null>((acc, row) => {
    const ts = row.last_synced_at;
    if (!acc || ts > acc) return ts;
    return acc;
  }, null);

  return {
    reporting_month: monthKey,
    last_reconciled_at: last,
    payments_checked: rows.length,
    warnings: [],
    ...summary,
  };
}
