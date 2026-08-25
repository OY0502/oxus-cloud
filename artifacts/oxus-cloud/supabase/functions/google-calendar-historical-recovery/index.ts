/**
 * Admin-only Calendar historical recovery (service role).
 * Does not start from CRM UI open. Preserves incremental sync tokens.
 */
import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import {
  dryRunCalendarHistoricalRecovery,
  runCalendarHistoricalRecoveryBatch,
} from "../_shared/googleCalendarHistoricalRecovery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-oxus-admin-repair",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function isServiceRoleAuthorized(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (serviceKey && token === serviceKey) return true;
  if (token.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
      return payload?.role === "service_role";
    } catch {
      return false;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isServiceRoleAuthorized(req)) {
    return json({ error: "Service role required", code: "AUTH_REQUIRED" }, 401);
  }
  if (req.headers.get("X-Oxus-Admin-Repair") !== "calendar-historical-2026-07-16") {
    return json({ error: "Repair header required", code: "CONFIRM_REQUIRED" }, 400);
  }

  const body = await req.json() as {
    connection_id?: string;
    google_email?: string;
    dry_run?: boolean;
    lookback_months?: number;
    operation_id?: string;
    confirm?: boolean;
  };

  const admin = getServiceRoleSupabase();
  let connectionQuery = admin.from("user_google_connections").select("*");
  if (body.connection_id) connectionQuery = connectionQuery.eq("id", body.connection_id);
  else if (body.google_email) connectionQuery = connectionQuery.eq("google_email", body.google_email);
  else return json({ error: "connection_id or google_email required" }, 400);

  const { data: connection, error } = await connectionQuery.maybeSingle();
  if (error || !connection) return json({ error: "Connection not found" }, 404);

  try {
    if (body.dry_run || !body.confirm) {
      const plan = await dryRunCalendarHistoricalRecovery(
        admin,
        connection,
        Number(body.lookback_months ?? 36) || 36,
      );
      return json({ ok: true, dry_run: true, plan });
    }

    const result = await runCalendarHistoricalRecoveryBatch(admin, connection, {
      operation_id: body.operation_id,
      lookback_months: Number(body.lookback_months ?? 36) || 36,
      dry_run: false,
    });
    return json({ ok: true, ...result });
  } catch (e) {
    console.error("[google-calendar-historical-recovery]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
