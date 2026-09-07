import { formatEUR, formatCurrency } from "@/lib/currency";
import { paidTimestampInReportingMonth } from "@/lib/reportingTimezone";
import type { Invoice, InvoicePaymentReconciliation } from "@/lib/types";

export type ReconciliationSourceBadge =
  | "Stripe actual"
  | "Native EUR"
  | "Manual"
  | "ECB reference"
  | "Paid outside Stripe"
  | "Unresolved";

export function reconciliationSourceBadge(row: InvoicePaymentReconciliation): ReconciliationSourceBadge {
  switch (row.amount_basis) {
    case "stripe_actual_settlement":
      return "Stripe actual";
    case "native_eur":
      return "Native EUR";
    case "manual":
      return "Manual";
    case "ecb_reference":
      return "ECB reference";
    case "paid_out_of_band_reference":
      return "Paid outside Stripe";
    default:
      return "Unresolved";
  }
}

export function minorToMajor(minor: number | null | undefined): number {
  return (minor ?? 0) / 100;
}

export function formatMinorEur(minor: number | null | undefined): string {
  return formatEUR(minorToMajor(minor));
}

export function formatOriginalPaid(row: InvoicePaymentReconciliation): string {
  return formatCurrency(minorToMajor(row.original_amount_minor), row.original_currency);
}

export function formatFxRate(row: InvoicePaymentReconciliation): string {
  if (row.amount_basis === "manual") return row.gross_eur_minor == null ? "Unavailable" : "Manual";
  if (row.amount_basis === "native_eur") return "Native EUR";
  if (row.stripe_exchange_rate != null) return `Stripe: ${Number(row.stripe_exchange_rate).toFixed(4)}`;
  if (row.reference_rate_to_eur != null) {
    const date = row.reference_rate_date
      ? new Date(row.reference_rate_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "—";
    return `ECB ref ${Number(row.reference_rate_to_eur).toFixed(4)} (${date})`;
  }
  return "—";
}

export function reconciliationStatusLabel(row: InvoicePaymentReconciliation): string {
  if (row.sync_status === "unavailable" || row.amount_basis === "unavailable") return "Unresolved";
  if (row.amount_basis === "ecb_reference" || row.amount_basis === "paid_out_of_band_reference") return "Reference";
  return "Reconciled";
}

export function stripeChargeUrl(chargeId: string | null | undefined, livemode = true): string | null {
  if (!chargeId) return null;
  return livemode
    ? `https://dashboard.stripe.com/payments/${chargeId}`
    : `https://dashboard.stripe.com/test/payments/${chargeId}`;
}

export function stripeBalanceTransactionUrl(id: string | null | undefined, livemode = true): string | null {
  if (!id) return null;
  return livemode
    ? `https://dashboard.stripe.com/balance/overview?txn=${id}`
    : `https://dashboard.stripe.com/test/balance/overview?txn=${id}`;
}

export interface PaidRevenueSummary {
  reportingMonth: string;
  grossEurMinor: number;
  stripeFeesEurMinor: number;
  netEurMinor: number;
  referenceFxDifferenceMinor: number;
  paymentCount: number;
  reconciledActualCount: number;
  manualCount: number;
  referenceCount: number;
  unresolvedCount: number;
  lastReconciledAt: string | null;
  fullyReconciled: boolean;
  hasData: boolean;
}

export function summarizePaidRevenueRows(
  rows: InvoicePaymentReconciliation[],
  reportingMonth: string,
): PaidRevenueSummary {
  let grossEurMinor = 0;
  let stripeFeesEurMinor = 0;
  let netEurMinor = 0;
  let referenceFxDifferenceMinor = 0;
  let reconciledActualCount = 0;
  let manualCount = 0;
  let referenceCount = 0;
  let unresolvedCount = 0;
  let lastReconciledAt: string | null = null;

  for (const row of rows) {
    if (row.gross_eur_minor != null) grossEurMinor += row.gross_eur_minor;
    if (row.stripe_fee_eur_minor != null) stripeFeesEurMinor += row.stripe_fee_eur_minor;
    if (row.net_eur_minor != null) netEurMinor += row.net_eur_minor;

    if (row.reference_eur_minor != null && row.gross_eur_minor != null && row.amount_basis === "stripe_actual_settlement") {
      referenceFxDifferenceMinor += row.gross_eur_minor - row.reference_eur_minor;
    }

    const badge = reconciliationSourceBadge(row);
    if (reconciliationStatusLabel(row) === "Unresolved") unresolvedCount += 1;
    else if (badge === "Manual") manualCount += 1;
    else if (badge === "Stripe actual" || badge === "Native EUR") reconciledActualCount += 1;
    else if (badge === "ECB reference" || badge === "Paid outside Stripe") referenceCount += 1;
    else unresolvedCount += 1;

    if (!lastReconciledAt || row.last_synced_at > lastReconciledAt) {
      lastReconciledAt = row.last_synced_at;
    }
  }

  return {
    reportingMonth,
    grossEurMinor,
    stripeFeesEurMinor,
    netEurMinor,
    referenceFxDifferenceMinor,
    paymentCount: rows.length,
    reconciledActualCount,
    manualCount,
    referenceCount,
    unresolvedCount,
    lastReconciledAt,
    fullyReconciled: unresolvedCount === 0 && rows.length > 0,
    hasData: rows.length > 0,
  };
}

export function manualInvoiceToPaidRevenueRow(
  invoice: Invoice,
  reportingMonth: string,
): InvoicePaymentReconciliation | null {
  if (
    invoice.provider !== "manual"
    || invoice.status !== "paid"
    || !paidTimestampInReportingMonth(invoice.paid_at, invoice.paid_date, reportingMonth)
  ) {
    return null;
  }

  const paidAt = invoice.paid_at
    ?? (invoice.paid_date ? `${invoice.paid_date}T12:00:00.000Z` : null);
  if (!paidAt) return null;

  const originalAmountMinor = Math.round(invoice.amount_paid * 100);
  const paidEur = invoice.amount_paid_eur
    ?? (invoice.currency.toUpperCase() === "EUR" ? invoice.amount_paid : null);
  const paidEurMinor = paidEur == null ? null : Math.round(paidEur * 100);
  const timestamp = invoice.updated_at || paidAt;

  return {
    id: `manual:${invoice.id}`,
    invoice_id: invoice.id,
    provider: "manual",
    external_invoice_payment_id: null,
    external_payment_intent_id: null,
    external_charge_id: null,
    external_balance_transaction_id: null,
    payment_type: "manual",
    paid_at: paidAt,
    reporting_month: reportingMonth,
    original_currency: invoice.currency,
    original_amount_minor: originalAmountMinor,
    settlement_currency: paidEurMinor == null ? null : "EUR",
    settlement_gross_minor: paidEurMinor,
    stripe_fee_minor: 0,
    settlement_net_minor: paidEurMinor,
    stripe_exchange_rate: null,
    reference_rate_to_eur: invoice.fx_rate_to_eur,
    reference_rate_date: invoice.fx_rate_date,
    reference_eur_minor: paidEurMinor,
    gross_eur_minor: paidEurMinor,
    stripe_fee_eur_minor: 0,
    net_eur_minor: paidEurMinor,
    amount_basis: "manual",
    is_paid_out_of_band: true,
    fee_details: [],
    sync_status: paidEurMinor == null ? "unavailable" : "local",
    sync_error: paidEurMinor == null ? "EUR value is unavailable for this manual payment." : null,
    metadata: { source: "manual_invoice" },
    last_synced_at: timestamp,
    created_at: invoice.created_at,
    updated_at: timestamp,
    invoices: {
      number: invoice.number,
      client_name: invoice.client_name,
      external_id: null,
      external_url: null,
      hosted_invoice_url: null,
      provider: "manual",
    },
  };
}

export function paidRevenueRowsToCsv(
  rows: Array<InvoicePaymentReconciliation & { invoices?: { number?: string; client_name?: string | null } | null }>,
  excludedIds?: Set<string>,
): string {
  const header = [
    "Invoice",
    "Client",
    "Paid date",
    "Original amount",
    "Original currency",
    "FX source",
    "FX rate",
    "Gross EUR",
    "Stripe fee EUR",
    "Net EUR",
    "Status",
    "Excluded",
  ];
  const lines = rows.map((row) => [
    row.invoices?.number ?? "",
    row.invoices?.client_name ?? "",
    row.paid_at,
    String(minorToMajor(row.original_amount_minor)),
    row.original_currency,
    reconciliationSourceBadge(row),
    formatFxRate(row),
    String(minorToMajor(row.gross_eur_minor)),
    String(minorToMajor(row.stripe_fee_eur_minor)),
    String(minorToMajor(row.net_eur_minor)),
    reconciliationStatusLabel(row),
    excludedIds?.has(row.id) ? "yes" : "no",
  ]);
  return [header, ...lines]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
