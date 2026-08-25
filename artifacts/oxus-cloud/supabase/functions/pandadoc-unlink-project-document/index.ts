import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
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
    await assertSuperAdminUser(req);

    let body: { attachment_id?: string; project_id?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const attachmentId = body.attachment_id?.trim();
    if (!attachmentId) return json({ error: "attachment_id is required." }, 400);

    const admin = getServiceRoleSupabase();
    const { data: attachment } = await admin
      .from("attachments")
      .select("*")
      .eq("id", attachmentId)
      .maybeSingle();

    if (!attachment) return json({ error: "Document association not found." }, 404);
    if (attachment.provider !== "pandadoc") {
      return json({ error: "Only PandaDoc associations can be unlinked with this endpoint." }, 400);
    }
    if (body.project_id && attachment.entity_id !== body.project_id) {
      return json({ error: "Document does not belong to this project." }, 400);
    }

    const { error } = await admin.from("attachments").delete().eq("id", attachmentId);
    if (error) return json({ error: error.message }, 500);

    await upsertProjectTimelineEvent(admin, {
      project_id: attachment.entity_id,
      source_type: "pandadoc",
      source_table: "attachments",
      source_id: attachment.id,
      external_id: attachment.external_id,
      event_type: "pandadoc_document_unlinked",
      event_title: "PandaDoc document unlinked",
      event_summary: `"${attachment.title ?? attachment.file_name ?? "Document"}" was unlinked from OXUS Cloud. The PandaDoc document was not deleted.`,
      priority: "low",
      visibility: "internal",
      metadata: {
        document_type: attachment.doc_type,
        external_id: attachment.external_id,
      },
    });

    return json({ unlinked: true });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[pandadoc-unlink-project-document]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
