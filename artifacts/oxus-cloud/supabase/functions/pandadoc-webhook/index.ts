import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  getPandaDocDocument,
  getPandaDocWebhookSharedKey,
  verifyPandaDocWebhookSignatureAsync,
  PandaDocError,
} from "../_shared/pandadoc.ts";
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

function extractDocumentId(payload: unknown): string | null {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const id = extractDocumentId(item);
      if (id) return id;
    }
    return null;
  }
  if (typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const data = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : row;
  const id =
    (typeof data.id === "string" && data.id) ||
    (typeof data.document_id === "string" && data.document_id) ||
    (typeof data.uuid === "string" && data.uuid) ||
    null;
  return id;
}

function extractEventType(payload: unknown): string | null {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const t = extractEventType(item);
      if (t) return t;
    }
    return null;
  }
  if (typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.event === "string") return row.event;
  if (typeof row.event_type === "string") return row.event_type;
  if (typeof row.type === "string") return row.type;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const sharedKey = getPandaDocWebhookSharedKey();
  if (!sharedKey) {
    console.error("[pandadoc-webhook] PANDADOC_WEBHOOK_SHARED_KEY is not configured");
    return json({ error: "Webhook not configured." }, 503);
  }

  const rawBody = await req.text();
  const url = new URL(req.url);
  const signature = url.searchParams.get("signature");

  const valid = await verifyPandaDocWebhookSignatureAsync(sharedKey, rawBody, signature);
  if (!valid) {
    console.error("[pandadoc-webhook] signature verification failed");
    return json({ error: "Forbidden." }, 403);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const documentId = extractDocumentId(payload);
  const eventType = extractEventType(payload) ?? "unknown";
  const eventKey = `${eventType}:${documentId ?? "none"}:${await hashShort(rawBody)}`;

  const admin = getServiceRoleSupabase();

  const { data: existingEvent } = await admin
    .from("pandadoc_webhook_events")
    .select("id")
    .eq("event_key", eventKey)
    .maybeSingle();

  if (existingEvent) {
    return json({ ok: true, duplicate: true });
  }

  await admin.from("pandadoc_webhook_events").insert({
    event_key: eventKey,
    event_type: eventType,
    document_id: documentId,
    payload: typeof payload === "object" && payload ? payload : { raw: rawBody.slice(0, 2000) },
  });

  await admin
    .from("pandadoc_integration_state")
    .update({
      webhook_last_received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (!documentId) {
    return json({ ok: true, processed: false, reason: "No document id in payload." });
  }

  const { data: attachments } = await admin
    .from("attachments")
    .select("id, entity_id, doc_type, title, file_name, status, external_id")
    .eq("provider", "pandadoc")
    .eq("external_id", documentId);

  if (!attachments?.length) {
    return json({ ok: true, processed: false, reason: "No linked OXUS documents." });
  }

  let updated = 0;
  let skippedArchived = 0;

  for (const row of attachments) {
    const project = await getProjectArchiveState(admin, row.entity_id);
    if (isProjectArchived(project)) {
      skippedArchived += 1;
      console.log(`[pandadoc-webhook] ${PROJECT_ARCHIVED_SKIP_MESSAGE} project=${row.entity_id}`);
      // Still refresh status metadata without noisy timeline for archived projects.
      try {
        const document = await getPandaDocDocument(documentId);
        await syncPandaDocAttachmentStatus(
          admin,
          {
            id: row.id,
            entity_id: row.entity_id,
            doc_type: row.doc_type,
            title: row.title,
            file_name: row.file_name,
            status: row.status,
            external_id: row.external_id as string,
          },
          document,
          { writeTimeline: false },
        );
        updated += 1;
      } catch (e) {
        if (!(e instanceof PandaDocError)) {
          console.error("[pandadoc-webhook] sync failed", (e as Error).message);
        }
      }
      continue;
    }

    try {
      const document = await getPandaDocDocument(documentId);
      await syncPandaDocAttachmentStatus(
        admin,
        {
          id: row.id,
          entity_id: row.entity_id,
          doc_type: row.doc_type,
          title: row.title,
          file_name: row.file_name,
          status: row.status,
          external_id: row.external_id as string,
        },
        document,
      );
      updated += 1;
    } catch (e) {
      console.error("[pandadoc-webhook] sync failed", (e as Error).message);
    }
  }

  return json({ ok: true, updated, skipped_archived: skippedArchived });
});

async function hashShort(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
