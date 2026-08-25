import { describe, expect, it } from "vitest";

describe("Supabase security architecture", () => {
  it("protects backend-only ingestion tables with RLS", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/migrations/20260823120000_supabase_security_and_stripe_reliability.sql",
        import.meta.url,
      ),
      "utf8",
    );

    for (const table of [
      "fx_rates",
      "google_gmail_threads",
      "google_import_batch_checkpoints",
      "google_import_source_runs",
      "google_relationship_groups",
    ]) {
      expect(source).toContain(
        `alter table if exists public.${table} enable row level security`,
      );
      expect(source).toContain(
        `revoke all on table public.${table} from anon, authenticated`,
      );
    }
  });

  it("makes API-facing views honor caller RLS", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/migrations/20260823120000_supabase_security_and_stripe_reliability.sql",
        import.meta.url,
      ),
      "utf8",
    );

    for (const view of [
      "user_clickup_connections_safe",
      "slack_workspaces_safe",
      "companies",
      "people",
      "unallocated_payouts_report",
      "user_google_connections_safe",
    ]) {
      expect(source).toContain(
        `alter view if exists public.${view} set (security_invoker = true)`,
      );
    }
  });

  it("pins function search paths and removes anonymous definer access", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/migrations/20260823120000_supabase_security_and_stripe_reliability.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain(
      "alter function public.normalize_auth_email(text) set search_path = public, pg_temp",
    );
    expect(source).toContain(
      "revoke execute on function public.current_user_role() from public, anon",
    );
    expect(source).toContain(
      "revoke execute on function public.handle_user_email_confirmed() from public, anon, authenticated",
    );
    expect(source).toContain(
      "grant execute on function public.process_client_invoice_payable_release(uuid) to service_role",
    );
  });

  it("fails closed when ClickUp webhook authentication is not configured", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL(
        "../../supabase/functions/clickup-webhook/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("if (!webhookSecret)");
    expect(source).toContain("Webhook authentication is not configured.");
  });
});
