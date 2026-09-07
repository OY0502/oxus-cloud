import { describe, expect, it, vi } from "vitest";
import { isMissingStripeInvoice, markStripeInvoiceDeleted } from "../../supabase/functions/_shared/stripeInvoiceDeletion";

describe("Stripe invoice deletion", () => {
  it("recognizes missing invoices without treating other failures as deletions", () => {
    expect(isMissingStripeInvoice({ code: "resource_missing", statusCode: 404, message: "No such invoice: 'in_deleted'" })).toBe(true);
    expect(isMissingStripeInvoice({ code: "resource_missing", statusCode: 404, param: "invoice" })).toBe(true);
    for (const error of [null, new Error("Network failure"),
      { code: "resource_missing", statusCode: 404, param: "customer" },
      { code: "api_key_expired", statusCode: 401 },
      { code: "resource_missing", statusCode: 500, param: "invoice" }]) {
      expect(isMissingStripeInvoice(error)).toBe(false);
    }
  });

  it("scopes tombstones to the Stripe invoice and propagates persistence failures", async () => {
    const eq = vi.fn();
    eq.mockReturnValueOnce({ eq }).mockResolvedValueOnce({ error: { message: "Database unavailable" } });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    await expect(markStripeInvoiceDeleted({ from } as never, "in_deleted")).rejects.toThrow("Database unavailable");
    expect(from).toHaveBeenCalledWith("invoices");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ sync_status: "deleted", stripe_status: "deleted" }));
    expect(eq.mock.calls).toEqual([["provider", "stripe"], ["external_id", "in_deleted"]]);
  });
});
