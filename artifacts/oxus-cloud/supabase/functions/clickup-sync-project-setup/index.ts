import { createClient } from "npm:@supabase/supabase-js@2";
import {
  applyClickupSetupUpdate,
  auditProjectClickupSetup,
  buildClickupDiagnosticsSummary,
  buildClickupSetupUpdatePlan,
  type ClickupProjectLinkRow,
} from "../_shared/clickupProjectSetup.ts";
import { CLICKUP_TEMPLATE_VERSION } from "../_shared/clickupTemplate.ts";
import {
  ClickupAuthError,
  clickupAuthErrorResponse,
  loadOxusActorProfile,
  resolveUserClickupForProject,
} from "../_shared/clickup-auth.ts";
import {
  assertInternalOxusAuthUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number, code: string, details?: string) {
  if (status >= 500) console.error(`[${code}] ${message}`, details ?? "");
  return json({ error: message, details, code }, status);
}

function getAnonKey(): string | null {
  const key = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (key) return key;
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Method not allowed.", 405, "INVALID_INPUT");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return err("Authentication required.", 401, "AUTH_REQUIRED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const anonKey = getAnonKey();
    if (!supabaseUrl || !anonKey) return err("Missing Supabase environment.", 500, "CONFIG_ERROR");

    let body: { project_id?: string; confirm?: boolean };
    try {
      body = await req.json();
    } catch {
      return err("Request body must be valid JSON.", 400, "INVALID_INPUT");
    }
    if (!body.project_id) return err("project_id is required.", 400, "INVALID_INPUT");
    if (body.confirm !== true) {
      return err("Update requires confirm=true after reviewing the update plan.", 400, "CONFIRMATION_REQUIRED");
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: auth } = await supabase.auth.getUser(token);
    let userId: string;
    try {
      userId = await assertInternalOxusAuthUser(auth.user);
    } catch (e) {
      if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const { data: link, error: linkErr } = await supabase
      .from("project_clickup_links")
      .select("*")
      .eq("project_id", body.project_id)
      .maybeSingle();
    if (linkErr) return err("Failed to load ClickUp link.", 500, "DB_ERROR", linkErr.message);
    if (!link?.clickup_space_id) {
      return err("This project is not linked to a ClickUp Space.", 404, "NOT_FOUND");
    }

    let clickup;
    let connection;
    try {
      ({ clickup, connection } = await resolveUserClickupForProject(userId, body.project_id));
    } catch (e) {
      if (e instanceof ClickupAuthError) return clickupAuthErrorResponse(e, corsHeaders);
      throw e;
    }

    const linkRow = link as ClickupProjectLinkRow;

    const { data: priorSuccess } = await supabase
      .from("clickup_setup_executions")
      .select("id, status, applied_changes")
      .eq("project_id", body.project_id)
      .eq("clickup_space_id", link.clickup_space_id)
      .eq("target_template_version", CLICKUP_TEMPLATE_VERSION)
      .in("status", ["succeeded", "partial"])
      .maybeSingle();

    const preAudit = await auditProjectClickupSetup({ clickup, link: linkRow, supabase });
    if (preAudit.status === "configured" && priorSuccess) {
      const plan = buildClickupSetupUpdatePlan(preAudit);
      const actor = await loadOxusActorProfile(userId);
      return json({
        audit: preAudit,
        plan,
        applied_changes: [],
        already_applied: true,
        diagnostics_summary: buildClickupDiagnosticsSummary({
          oxusUser: actor.full_name ?? actor.email,
          clickupAccount: connection.clickup_username ?? connection.clickup_email,
          workspace: connection.selected_team_name,
          link: linkRow,
          audit: preAudit,
        }),
      });
    }

    const result = await applyClickupSetupUpdate({
      supabase,
      clickup,
      projectId: body.project_id,
      link: linkRow,
      actorUserId: userId,
      webhookEndpoint: Deno.env.get("CLICKUP_WEBHOOK_ENDPOINT")?.trim(),
      webhookSecret: Deno.env.get("CLICKUP_WEBHOOK_SECRET")?.trim(),
    });

    const actor = await loadOxusActorProfile(userId);
    return json({
      audit: result.audit,
      plan: result.plan,
      applied_changes: result.applied_changes,
      execution_id: result.execution_id,
      update_result: result.update_result,
      diagnostics_summary: buildClickupDiagnosticsSummary({
        oxusUser: actor.full_name ?? actor.email,
        clickupAccount: connection.clickup_username ?? connection.clickup_email,
        workspace: connection.selected_team_name,
        link: {
          ...linkRow,
          clickup_template_version: CLICKUP_TEMPLATE_VERSION,
          clickup_setup_audited_at: new Date().toISOString(),
          clickup_setup_updated_at: new Date().toISOString(),
        },
        audit: result.audit,
      }),
    });
  } catch (e) {
    console.error("[UNEXPECTED_ERROR]", (e as Error).message);
    return err("Unexpected error.", 500, "UNEXPECTED_ERROR", (e as Error).message);
  }
});
