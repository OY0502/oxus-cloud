import { formatEUR, formatCurrency } from "@/lib/currency";
import type { InvoicePaymentReconciliation } from "@/lib/types";

export type ReconciliationSourceBadge =
  | "Stripe actual"
  | "Native EUR"
  | "ECB reference"
  | "Paid outside Stripe"
  | "Unresolved";

export function reconciliationSourceBadge(row: InvoicePaymentReconciliation): ReconciliationSourceBadge {
  switch (row.amount_basis) {
    case "stripe_actual_settlement":
      return "Stripe actual";
    case "native_eur":
      return "Native EUR";
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
    if (badge === "Stripe actual" || badge === "Native EUR") reconciledActualCount += 1;
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
    referenceCount,
    unresolvedCount,
    lastReconciledAt,
    fullyReconciled: unresolvedCount === 0 && rows.length > 0,
    hasData: rows.length > 0,
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
