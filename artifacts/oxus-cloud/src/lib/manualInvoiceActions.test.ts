import { describe, expect, it } from "vitest";
import { classifyInvoiceFinancialState } from "./invoiceClassification";
import { getAvailableInvoiceActions, type Invoice } from "./invoices";

const invoice = (status: Invoice["status"]) => ({
  id: "manual", provider: "manual", externalId: null, stripeStatus: "—", syncStatus: "local",
  status, dueDate: "2099-10-06", amountDue: 5940, amountPaid: 0, total: 5940,
  projectId: null, project: "Carrotz", hostedInvoiceUrl: null,
} as Invoice);

describe("manual invoice lifecycle", () => {
  it("does not put an internal draft in Needs Attention regardless of its due date", () => {
    const state = classifyInvoiceFinancialState(invoice("draft"));
    expect(state.category).toBe("draft");
    expect(state.countsTowardDueSoon).toBe(false);
    expect(state.needsAttention).toBe(false);
  });

  it("offers useful actions without Stripe actions", () => {
    const draft = getAvailableInvoiceActions(invoice("draft"));
    expect(draft.overflow.filter((action) => action.manualAction).map((action) => action.id))
      .toEqual(["mark_sent", "mark_paid", "void"]);
    expect(draft.overflow.some((action) => action.stripeAction)).toBe(false);

    const sent = getAvailableInvoiceActions(invoice("sent"));
    expect(sent.primary?.id).toBe("mark_paid");
    expect(sent.overflow.map((action) => action.id)).toContain("return_to_draft");

    const paid = getAvailableInvoiceActions(invoice("paid"));
    expect(paid.overflow.map((action) => action.id)).toContain("return_to_draft");
  });
});
