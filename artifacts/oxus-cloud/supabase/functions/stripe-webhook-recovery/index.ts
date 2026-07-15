import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { authenticateInternalWorker, internalWorkerAuthErrorResponse } from "../_shared/internalWorkerAuth.ts";
import { getStripeWebhookSecret } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-internal-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const WEBHOOK_PATH = "/functions/v1/stripe-webhook";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function countByStatus(admin: ReturnType<typeof getServiceRoleSupabase>, status: string): Promise<number> {
  const { count, error } = await admin
    .from("stripe_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function dispatchProcessing(inboxId: string): Promise<{ ok: boolean; status: number }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) return { ok: false, status: 500 };

  const workerSecret = Deno.env.get("GOOGLE_SYNC_WORKER_SECRET")?.trim();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };
  if (workerSecret) headers["x-oxus-internal-secret"] = workerSecret;

  const response = await fetch(`${supabaseUrl}/functions/v1/process-stripe-webhook-event`, {
    method: "POST",
    headers,
    body: JSON.stringify({ inbox_id: inboxId }),
  });
  return { ok: response.ok, status: response.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method === "GET") {
      await assertSuperAdminUser(req);
      const admin = getServiceRoleSupabase();
      const { data: state } = await admin.from("stripe_integration_state").select("*").limit(1).maybeSingle();

      const [pendingCount, receivedCount, failed, processing] = await Promise.all([
        countByStatus(admin, "pending"),
        countByStatus(admin, "received"),
        countByStatus(admin, "failed"),
        countByStatus(admin, "processing"),
      ]);
      const pending = pendingCount + receivedCount;

      const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
      const endpointUrl = state?.webhook_endpoint_url
        ?? (supabaseUrl ? `${supabaseUrl}${WEBHOOK_PATH}` : null);

      let endpointReachable: boolean | null = null;
      if (endpointUrl) {
        try {
          const probe = await fetch(endpointUrl, { method: "POST", body: "{}" });
          endpointReachable = probe.status === 400 || probe.status === 200;
        } catch {
          endpointReachable = false;
        }
      }

      const { data: recentFailed } = await admin
        .from("stripe_webhook_events")
        .select("id, stripe_event_id, event_type, status, attempt_count, received_at, processed_at, error_message")
        .in("status", ["failed", "pending", "processing", "received"])
        .order("received_at", { ascending: false })
        .limit(25);

      return json({
        endpoint_url: endpointUrl,
        endpoint_reachable: endpointReachable,
        signature_configured: !!getStripeWebhookSecret(),
        webhook_last_received_at: state?.webhook_last_received_at ?? null,
        webhook_last_processed_at: state?.webhook_last_processed_at ?? null,
        webhook_last_event_id: state?.webhook_last_event_id ?? null,
        pending_events: pending,
        failed_events: failed,
        processing_events: processing,
        events: recentFailed ?? [],
      });
    }

    if (req.method === "POST") {
      const workerAuth = await authenticateInternalWorker(req);
      let isSuperAdmin = false;
      if (!workerAuth.ok) {
        try {
          await assertSuperAdminUser(req);
          isSuperAdmin = true;
        } catch (e) {
          if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
          if (!workerAuth.ok) return internalWorkerAuthErrorResponse(workerAuth.code, crypto.randomUUID(), corsHeaders);
        }
      }

      const body = await req.json().catch(() => ({})) as {
        action?: string;
        inbox_ids?: string[];
        limit?: number;
      };

      if (body.action !== "retry") {
        return json({ error: "Unsupported action." }, 400);
      }

      const admin = getServiceRoleSupabase();
      const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 50);
      let query = admin
        .from("stripe_webhook_events")
        .select("id, stripe_event_id, event_type, status, attempt_count, received_at, error_message")
        .in("status", ["failed", "pending", "received"])
        .order("received_at", { ascending: true })
        .limit(limit);

      if (body.inbox_ids?.length) {
        query = admin
          .from("stripe_webhook_events")
          .select("id, stripe_event_id, event_type, status, attempt_count, received_at, error_message")
          .in("id", body.inbox_ids)
          .limit(limit);
      }

      const { data: targets, error } = await query;
      if (error) throw new Error(error.message);

      const results: Array<{
        inbox_id: string;
        stripe_event_id: string;
        ok: boolean;
        status: number;
      }> = [];

      for (const row of targets ?? []) {
        const dispatch = await dispatchProcessing(row.id);
        results.push({
          inbox_id: row.id,
          stripe_event_id: row.stripe_event_id,
          ok: dispatch.ok,
          status: dispatch.status,
        });
      }

      return json({
        retried: results.length,
        results,
        initiated_by: workerAuth.ok ? "worker" : (isSuperAdmin ? "super_admin" : "unknown"),
      });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[stripe-webhook-recovery]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
