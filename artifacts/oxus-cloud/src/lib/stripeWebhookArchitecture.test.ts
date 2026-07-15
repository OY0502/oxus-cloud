import { describe, expect, it } from "vitest";

describe("stripe webhook architecture", () => {
  it("stripe-webhook uses raw body before JSON parsing", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../../supabase/functions/stripe-webhook/index.ts", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).toContain("await req.text()");
    expect(source).toContain("constructEvent(rawBody");
    expect(source).not.toMatch(/await req\.json\(\)[\s\S]*constructEvent/);
  });

  it("stripe-webhook is configured public in supabase config", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../../supabase/config.toml", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).toContain("[functions.stripe-webhook]");
    expect(source).toMatch(/\[functions\.stripe-webhook\][\s\S]*verify_jwt = false/);
  });

  it("uses STRIPE_WEBHOOK_SECRET consistently", async () => {
    const fs = await import("node:fs/promises");
    const stripeShared = await fs.readFile(
      new URL("../../supabase/functions/_shared/stripe.ts", import.meta.url),
      "utf8",
    );
    expect(stripeShared).toContain('Deno.env.get("STRIPE_WEBHOOK_SECRET")');
    expect(stripeShared).not.toContain("STRIPE_WEBHOOK_SIGNING_SECRET");
  });

  it("webhook handler stores inbox before returning 200", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../../supabase/functions/stripe-webhook/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("insertStripeWebhookInboxEvent");
    expect(source).toContain("process-stripe-webhook-event");
    expect(source).not.toContain("upsertStripeInvoice");
  });

  it("processor supports invoice and customer events used by OXUS", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../../supabase/functions/_shared/stripeWebhookProcessor.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("invoice.paid");
    expect(source).toContain("invoice.finalized");
    expect(source).toContain("customer.updated");
    expect(source).toContain("STRIPE_SUPPORTED_EVENTS");
  });
});
