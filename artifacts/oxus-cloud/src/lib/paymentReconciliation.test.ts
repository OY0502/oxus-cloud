import { describe, expect, it } from "vitest";
import type { Invoice } from "./types";
import { manualInvoiceToPaidRevenueRow, summarizePaidRevenueRows } from "./paymentReconciliation";

function manualInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    number: "Wise INV-013",
    client_id: "client-1",
    client_name: "Carrotz",
    project_id: "project-1",
    project: "Carrotz",
    amount: 5940,
    amount_paid: 5940,
    amount_due: 0,
    status: "paid",
    issue_date: "2026-09-07",
    issued_at: "2026-09-07T12:00:00.000Z",
    due_date: "2026-10-06",
    due_at: null,
    paid_date: "2026-09-07",
    payment_method: null,
    owner_id: null,
    owner_name: null,
    last_reminder_at: null,
    stripe_status: null,
    provider: "manual",
    external_id: null,
    external_customer_id: null,
    external_url: null,
    hosted_invoice_url: null,
    currency: "EUR",
    subtotal: 5940,
    tax_amount: 0,
    total: 5940,
    amount_eur: 5940,
    amount_due_eur: 0,
    amount_paid_eur: 5940,
    subtotal_eur: 5940,
    tax_amount_eur: 0,
    fx_status: "native",
    fx_rate_to_eur: 1,
    fx_rate_date: "2026-09-07",
    sync_status: "local",
    last_synced_at: null,
    company_mapping_status: "mapped",
    attention_dismissed_at: null,
    attention_dismissed_by: null,
    attention_dismiss_reason: null,
    paid_at: "2026-09-07T09:00:00.000Z",
    created_at: "2026-09-07T08:00:00.000Z",
    updated_at: "2026-09-07T09:00:00.000Z",
    ...overrides,
  };
}

describe("manual invoices in paid revenue", () => {
  it("converts a paid manual invoice into a zero-fee revenue row", () => {
    const row = manualInvoiceToPaidRevenueRow(manualInvoice(), "2026-09");

    expect(row).toMatchObject({
      id: "manual:invoice-1",
      amount_basis: "manual",
      original_amount_minor: 594000,
      gross_eur_minor: 594000,
      stripe_fee_eur_minor: 0,
      net_eur_minor: 594000,
      sync_status: "local",
      invoices: { number: "Wise INV-013", client_name: "Carrotz", provider: "manual" },
    });
  });

  it("includes the manual payment in monthly totals and counts", () => {
    const row = manualInvoiceToPaidRevenueRow(manualInvoice(), "2026-09");
    expect(row).not.toBeNull();

    const summary = summarizePaidRevenueRows([row!], "2026-09");
    expect(summary).toMatchObject({
      grossEurMinor: 594000,
      stripeFeesEurMinor: 0,
      netEurMinor: 594000,
      paymentCount: 1,
      manualCount: 1,
      unresolvedCount: 0,
    });
  });

  it("excludes manual invoices outside the selected paid month", () => {
    expect(manualInvoiceToPaidRevenueRow(manualInvoice(), "2026-08")).toBeNull();
    expect(manualInvoiceToPaidRevenueRow(manualInvoice({ status: "sent" }), "2026-09")).toBeNull();
  });
});
