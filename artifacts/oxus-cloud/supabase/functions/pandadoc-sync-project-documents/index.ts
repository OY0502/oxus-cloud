import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { getPandaDocDocument, PandaDocError } from "../_shared/pandadoc.ts";
import { syncPandaDocAttachmentStatus } from "../_shared/pandadocDocuments.ts";
import {
  getProjectArchiveState,
  isProjectArchived,
  PROJECT_ARCHIVED_SKIP_MESSAGE,
} from "../_shared/projectArchive.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await assertSuperAdminUser(req);

    let body: { project_id?: string; force?: boolean } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }

    const projectId = body.project_id?.trim();
    if (!projectId) return json({ error: "project_id is required." }, 400);

    const admin = getServiceRoleSupabase();
    const project = await getProjectArchiveState(admin, projectId);
    if (!project) return json({ error: "Project not found." }, 404);

    if (isProjectArchived(project) && !body.force) {
      return json({
        skipped: true,
        reason: PROJECT_ARCHIVED_SKIP_MESSAGE,
        synced: 0,
        failed: 0,
      });
    }

    const { data: attachments, error } = await admin
      .from("attachments")
      .select("id, entity_id, doc_type, title, file_name, status, external_id")
      .eq("entity_type", "project")
      .eq("entity_id", projectId)
      .eq("provider", "pandadoc")
      .not("external_id", "is", null);

    if (error) return json({ error: error.message }, 500);

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of attachments ?? []) {
      try {
        const document = await getPandaDocDocument(row.external_id as string);
        await syncPandaDocAttachmentStatus(admin, {
          id: row.id,
          entity_id: row.entity_id,
          doc_type: row.doc_type,
          title: row.title,
          file_name: row.file_name,
          status: row.status,
          external_id: row.external_id as string,
        }, document);
        synced += 1;
      } catch (e) {
        failed += 1;
        errors.push(`${row.external_id}: ${(e as Error).message}`);
      }
    }

    await admin
      .from("pandadoc_integration_state")
      .update({
        last_successful_sync_at: failed === 0 ? new Date().toISOString() : undefined,
        last_sync_error: failed > 0 ? errors.slice(0, 5).join("; ") : null,
        updated_at: new Date().toISOString(),
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    return json({ synced, failed, errors: errors.slice(0, 10), skipped: false });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    if (e instanceof PandaDocError) {
      return json({ error: e.message, code: e.code, details: e.details }, e.status);
    }
    console.error("[pandadoc-sync-project-documents]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
