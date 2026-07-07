import { createClient } from "npm:@supabase/supabase-js@2";
import {
  backfillProjectTimelineFromExisting,
} from "../_shared/projectTimelineEvents.ts";
import { processSlackThreadIntelligenceForProject } from "../_shared/slackPmActions.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.project_id === "string" ? body.project_id : null;
  if (!projectId) return json({ error: "project_id is required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const backfill = await backfillProjectTimelineFromExisting({ admin, projectId });
    const intelligence = await processSlackThreadIntelligenceForProject({
      admin,
      projectId,
      createdBy: userData.user.id,
    });

    return json({
      ok: true,
      project_id: projectId,
      clickup_synced: backfill.clickup_synced,
      slack_signals_synced: backfill.slack_signals_synced,
      actions_created: intelligence.actions_created,
      actions_updated: intelligence.actions_updated,
      actions_auto_resolved: intelligence.actions_auto_resolved,
      actions_suppressed: intelligence.actions_suppressed,
      timeline_events_created: intelligence.timeline_events_created,
      timeline_events_updated: intelligence.timeline_events_updated,
      threads_checked: intelligence.threads_checked,
      duplicates_avoided: intelligence.duplicates_avoided,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
