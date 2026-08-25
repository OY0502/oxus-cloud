import { supabase } from "@/lib/supabase";

const DOCUMENTS_BUCKET = "documents";

/** Remove stored files for a project (image + attachments + image folder). */
export async function purgeProjectStorage(
  projectId: string,
  imagePath: string | null | undefined,
): Promise<void> {
  const paths = new Set<string>();
  if (imagePath?.trim()) paths.add(imagePath.trim());

  const { data: attachments } = await supabase
    .from("attachments")
    .select("file_path")
    .eq("entity_type", "project")
    .eq("entity_id", projectId);
  for (const row of attachments ?? []) {
    if (row.file_path) paths.add(row.file_path);
  }

  const { data: imageFolder } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .list(`project-images/${projectId}`);
  for (const file of imageFolder ?? []) {
    if (file.name) paths.add(`project-images/${projectId}/${file.name}`);
  }

  const batch = [...paths];
  if (batch.length === 0) return;

  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(batch);
  if (error) throw new Error(error.message);
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  // Purge the external namespace while project authorization still exists.
  // The database deletion trigger also leaves a durable retry job if Pinecone
  // is temporarily unavailable, so an external outage never blocks deletion.
  const { error: pineconeError } = await supabase.functions.invoke("pinecone-chat-memory", {
    body: { action: "delete_namespace", project_id: projectId },
  });
  if (pineconeError) console.warn("Pinecone namespace purge was queued for retry:", pineconeError.message);

  const { error } = await supabase.rpc("delete_project", { p_project_id: projectId });
  if (error) throw new Error(error.message);
}
