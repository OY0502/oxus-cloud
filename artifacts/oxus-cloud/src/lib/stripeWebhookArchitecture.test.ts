import { describe, expect, it } from "vitest";

describe("stripe webhook architecture", () => {
  it("stripe-webhook uses raw body before JSON parsing", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL(
      "../../supabase/functions/stripe-webhook/index.ts",
      import.meta.url,
    );
    const source = await fs.readFile(path, "utf8");
    expect(source).toContain("await req.text()");
    expect(source).toContain("await stripe.webhooks.constructEventAsync(");
    expect(source).not.toMatch(/await req\.json\(\)[\s\S]*constructEventAsync/);
  });

  it("stripe-webhook is configured public in supabase config", async () => {
    const fs = await import("node:fs/promises");
    const path = new URL("../../supabase/config.toml", import.meta.url);
    const source = await fs.readFile(path, "utf8");
    expect(source).toContain("[functions.stripe-webhook]");
    expect(source).toMatch(
      /\[functions\.stripe-webhook\][\s\S]*verify_jwt = false/,
    );
    expect(source).toMatch(
      /\[functions\.stripe-webhook-recovery\][\s\S]*verify_jwt = false/,
    );
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
      new URL(
        "../../supabase/functions/stripe-webhook/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("insertStripeWebhookInboxEvent");
    expect(source).toContain("process-stripe-webhook-event");
    expect(source).not.toContain("upsertStripeInvoice");
  });

  it("processor supports invoice and customer events used by OXUS", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/functions/_shared/stripeWebhookProcessor.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("invoice.paid");
    expect(source).toContain("invoice.finalized");
    expect(source).toContain("customer.updated");
    expect(source).toContain("STRIPE_SUPPORTED_EVENTS");
  });

  it("claims an inbox row without allowing concurrent processing claims", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/functions/_shared/stripeWebhookInbox.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain(
      '.in("status", ["pending", "received", "failed"])',
    );
    expect(source).not.toContain(
      '.in("status", ["pending", "received", "failed", "processing"])',
    );
    expect(source).toContain('state: "busy"');
  });

  it("automatically recovers stuck inbox events", async () => {
    const fs = await import("node:fs/promises");
    const [recovery, trigger] = await Promise.all([
      fs.readFile(
        new URL(
          "../../supabase/functions/stripe-webhook-recovery/index.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      fs.readFile(new URL("../trigger/index.ts", import.meta.url), "utf8"),
    ]);
    expect(recovery).toContain("STALE_PROCESSING_MS");
    expect(recovery).toContain("Processing lease expired");
    expect(trigger).toContain('id: "recover-stripe-webhook-events"');
    expect(trigger).toContain('pattern: "17 */6 * * *"');
    expect(trigger).toContain("limit: 50");
  });

  it("rotates webhook endpoints in two phases", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/functions/stripe-rotate-webhook-secret/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain('action?: "prepare" | "verify" | "finalize"');
    expect(source).toContain("previous_endpoint_ids");
    expect(source.indexOf("webhookEndpoints.create")).toBeGreaterThan(
      source.indexOf('action !== "prepare"'),
    );
  });

  it("can verify the deployed signing secret without mutating Stripe data", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/functions/stripe-rotate-webhook-secret/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain('action === "verify"');
    expect(source).toContain("generateTestHeaderStringAsync");
    expect(source).toContain('type: "oxus.webhook.healthcheck"');
  });
});
