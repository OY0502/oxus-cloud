import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { getPandaDocDocument, PandaDocError } from "../_shared/pandadoc.ts";
import { mapInputDocType, upsertPandaDocAttachment } from "../_shared/pandadocDocuments.ts";
import { upsertProjectTimelineEvent } from "../_shared/projectTimelineEvents.ts";

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
    const auth = await assertSuperAdminUser(req);

    let body: {
      project_id?: string;
      pandadoc_document_id?: string;
      document_type?: string;
      label?: string;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const projectId = body.project_id?.trim();
    const documentId = body.pandadoc_document_id?.trim();
    if (!projectId || !documentId || !body.document_type) {
      return json({ error: "project_id, pandadoc_document_id, and document_type are required." }, 400);
    }

    let docType;
    try {
      docType = mapInputDocType(body.document_type);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }

    const admin = getServiceRoleSupabase();
    const { data: project } = await admin
      .from("projects")
      .select("id, name, archived_at")
      .eq("id", projectId)
      .maybeSingle();

    if (!project) return json({ error: "Project not found." }, 404);

    const document = await getPandaDocDocument(documentId);
    const attachment = await upsertPandaDocAttachment(admin, {
      projectId,
      docType,
      document,
      label: body.label,
      linkedBy: auth.userId,
    });

    await upsertProjectTimelineEvent(admin, {
      project_id: projectId,
      source_type: "pandadoc",
      source_table: "attachments",
      source_id: attachment.id as string,
      external_id: document.external_id,
      event_type: "pandadoc_document_linked",
      event_title: "PandaDoc document linked",
      event_summary: `"${document.name}" linked as ${docType === "sow" ? "Active SOW" : docType.toUpperCase()}.`,
      source_url: document.external_url ?? null,
      priority: "medium",
      visibility: "internal",
      metadata: {
        document_type: docType,
        status: document.status,
      },
    });

    return json({ document: attachment });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    if (e instanceof PandaDocError) {
      return json({ error: e.message, code: e.code, details: e.details }, e.status);
    }
    console.error("[pandadoc-link-project-document]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
