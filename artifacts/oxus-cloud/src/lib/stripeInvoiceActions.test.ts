import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeStripeInvoiceAction } from "../../supabase/functions/_shared/stripeInvoiceActions";

const stripe = vi.hoisted(() => ({ invoices: { retrieve: vi.fn(), del: vi.fn() } }));
vi.mock("../../supabase/functions/_shared/stripe.ts", () => ({ createStripeClient: () => stripe }));
vi.mock("../../supabase/functions/_shared/stripeInvoiceSync.ts", () => ({ upsertStripeInvoice: vi.fn() }));

function database() {
  const local = { id: "local", provider: "stripe", external_id: "in_deleted", stripe_status: "draft" };
  const query: any = {
    select: vi.fn(() => query), eq: vi.fn(() => query),
    single: vi.fn(async () => ({ data: local })),
    update: vi.fn(() => query), insert: vi.fn(async () => ({ error: null })),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return { admin: { from: vi.fn(() => query) } as never, query };
}

describe("Stripe deletion actions", () => {
  const missing = { code: "resource_missing", statusCode: 404, message: "No such invoice: 'in_deleted'" };
  beforeEach(() => vi.clearAllMocks());

  it("removes an already-deleted invoice without sending another Stripe delete", async () => {
    const { admin, query } = database();
    stripe.invoices.retrieve.mockRejectedValueOnce(missing);
    const result = await executeStripeInvoiceAction(admin, "user", "local", "delete_draft");
    expect(result.already_done).toBe(true);
    expect(result.invoice.sync_status).toBe("deleted");
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ sync_status: "deleted" }));
    expect(stripe.invoices.del).not.toHaveBeenCalled();
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ success: true, resulting_stripe_status: "deleted" }));
  });

  it("handles a deletion racing with the user's delete action", async () => {
    const { admin, query } = database();
    stripe.invoices.retrieve.mockResolvedValueOnce({ status: "draft" });
    stripe.invoices.del.mockRejectedValueOnce(missing);
    await executeStripeInvoiceAction(admin, "user", "local", "delete_draft");
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ stripe_status: "deleted" }));
  });

  it("preserves local invoices when Stripe is unavailable", async () => {
    const { admin, query } = database();
    stripe.invoices.retrieve.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(executeStripeInvoiceAction(admin, "user", "local", "delete_draft")).rejects.toThrow("Stripe unavailable");
    expect(query.update).not.toHaveBeenCalled();
  });

  it("does not delete an existing finalized invoice", async () => {
    const { admin, query } = database();
    stripe.invoices.retrieve.mockResolvedValueOnce({ status: "open" });
    await expect(executeStripeInvoiceAction(admin, "user", "local", "delete_draft")).rejects.toThrow("Only draft invoices");
    expect(stripe.invoices.del).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
  });
});
