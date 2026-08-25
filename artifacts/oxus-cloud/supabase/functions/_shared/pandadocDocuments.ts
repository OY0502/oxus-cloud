import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type NormalizedPandaDocDocument,
  pandadocStatusTimelineCopy,
  isSafeExternalUrl,
} from "./pandadoc.ts";
import { upsertProjectTimelineEvent } from "./projectTimelineEvents.ts";

export type ProjectDocTypeSlot = "msa" | "nda" | "sow" | "other";

export function mapInputDocType(input: string): ProjectDocTypeSlot {
  if (input === "active_sow" || input === "sow") return "sow";
  if (input === "msa" || input === "nda" || input === "other") return input;
  throw new Error(`Unsupported document_type: ${input}`);
}

/**
 * When assigning a new Active SOW, supersede prior active SOWs (upload or PandaDoc).
 * History is preserved — never delete the PandaDoc document remotely.
 */
export async function supersedeActiveSows(
  admin: SupabaseClient,
  projectId: string,
  newAttachmentId?: string,
): Promise<void> {
  const { data: existing } = await admin
    .from("attachments")
    .select("id")
    .eq("entity_type", "project")
    .eq("entity_id", projectId)
    .eq("doc_type", "sow")
    .eq("is_active", true);

  const ids = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => id !== newAttachmentId);

  if (ids.length === 0) return;

  await admin
    .from("attachments")
    .update({
      doc_type: "other",
      is_active: false,
      superseded_at: new Date().toISOString(),
      superseded_by_id: newAttachmentId ?? null,
    })
    .in("id", ids);
}

export async function upsertPandaDocAttachment(
  admin: SupabaseClient,
  args: {
    projectId: string;
    docType: ProjectDocTypeSlot;
    document: NormalizedPandaDocDocument;
    label?: string | null;
    linkedBy?: string | null;
  },
): Promise<Record<string, unknown>> {
  const title = args.label?.trim() || args.document.name;
  const externalUrl = isSafeExternalUrl(args.document.external_url)
    ? args.document.external_url!
    : null;

  const { data: existing } = await admin
    .from("attachments")
    .select("*")
    .eq("entity_type", "project")
    .eq("entity_id", args.projectId)
    .eq("provider", "pandadoc")
    .eq("external_id", args.document.external_id)
    .maybeSingle();

  if (args.docType === "sow") {
    await supersedeActiveSows(admin, args.projectId, existing?.id);
  }

  // MSA: keep one current active MSA — supersede prior MSA rows of any provider.
  if (args.docType === "msa") {
    await admin
      .from("attachments")
      .update({ is_active: false, superseded_at: new Date().toISOString() })
      .eq("entity_type", "project")
      .eq("entity_id", args.projectId)
      .eq("doc_type", "msa")
      .eq("is_active", true)
      .neq("id", existing?.id ?? "00000000-0000-0000-0000-000000000000");
  }

  const row = {
    entity_type: "project",
    entity_id: args.projectId,
    doc_type: args.docType,
    is_active: true,
    provider: "pandadoc",
    external_id: args.document.external_id,
    external_url: externalUrl,
    status: args.document.status,
    title,
    file_name: title,
    file_path: null,
    file_size: null,
    mime_type: "application/pandadoc",
    metadata: {
      ...args.document.metadata,
      recipients: args.document.recipients ?? [],
      owner_name: args.document.owner_name ?? null,
      date_created: args.document.date_created ?? null,
      date_modified: args.document.date_modified ?? null,
      date_sent: args.document.date_sent ?? null,
      date_completed: args.document.date_completed ?? null,
      folder_id: args.document.folder_id ?? null,
    },
    last_synced_at: new Date().toISOString(),
    uploaded_by: args.linkedBy ?? null,
    superseded_at: null,
    superseded_by_id: null,
  };

  if (existing) {
    const { data, error } = await admin
      .from("attachments")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }

  const { data, error } = await admin.from("attachments").insert(row).select("*").single();
  if (error) throw new Error(error.message);

  if (args.docType === "sow" && data?.id) {
    await supersedeActiveSows(admin, args.projectId, data.id as string);
  }

  return data as Record<string, unknown>;
}

export async function syncPandaDocAttachmentStatus(
  admin: SupabaseClient,
  attachment: {
    id: string;
    project_id?: string;
    entity_id: string;
    doc_type: string;
    title?: string | null;
    file_name?: string | null;
    status?: string | null;
    external_id: string;
  },
  document: NormalizedPandaDocDocument,
  options?: { writeTimeline?: boolean },
): Promise<{ updated: boolean; statusChanged: boolean }> {
  const previousStatus = (attachment.status ?? "").toLowerCase();
  const nextStatus = document.status.toLowerCase();
  const statusChanged = previousStatus !== nextStatus;
  const title = document.name || attachment.title || attachment.file_name || "Document";

  const { error } = await admin
    .from("attachments")
    .update({
      status: document.status,
      title,
      file_name: title,
      external_url: isSafeExternalUrl(document.external_url) ? document.external_url : null,
      metadata: {
        ...document.metadata,
        recipients: document.recipients ?? [],
        owner_name: document.owner_name ?? null,
        date_created: document.date_created ?? null,
        date_modified: document.date_modified ?? null,
        date_sent: document.date_sent ?? null,
        date_completed: document.date_completed ?? null,
        folder_id: document.folder_id ?? null,
      },
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", attachment.id);

  if (error) throw new Error(error.message);

  if (options?.writeTimeline !== false && statusChanged) {
    const copy = pandadocStatusTimelineCopy(attachment.doc_type, document.status, title);
    if (copy) {
      await upsertProjectTimelineEvent(admin, {
        project_id: attachment.entity_id,
        source_type: "pandadoc",
        source_table: "attachments",
        source_id: attachment.id,
        external_id: `${attachment.external_id}:${document.status}`,
        event_type: `pandadoc_status_${document.status.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        event_title: copy.title,
        event_summary: copy.summary,
        source_url: isSafeExternalUrl(document.external_url) ? document.external_url : null,
        priority: "medium",
        visibility: "internal",
        metadata: {
          previous_status: attachment.status,
          status: document.status,
          document_id: document.external_id,
        },
      });
    }
  }

  return { updated: true, statusChanged };
}
