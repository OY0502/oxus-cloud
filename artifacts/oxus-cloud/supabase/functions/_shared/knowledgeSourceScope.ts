export const INACTIVE_KNOWLEDGE_SYNC_STATUSES = [
  "out_of_scope",
  "unknown_scope",
  "archived",
  "deleted",
] as const;

export type KnowledgeSyncStatus = "active" | (typeof INACTIVE_KNOWLEDGE_SYNC_STATUSES)[number];

export function isActiveKnowledgeSyncStatus(status: string | null | undefined): boolean {
  return (status ?? "active") === "active";
}

export async function loadActiveKnowledgeSourceIds(
  admin: { from: (table: string) => ReturnType<import("npm:@supabase/supabase-js@2").SupabaseClient["from"]> },
  projectId: string,
): Promise<Set<string>> {
  const { data } = await admin
    .from("project_knowledge_sources")
    .select("id")
    .eq("project_id", projectId)
    .eq("sync_status", "active");
  return new Set((data ?? []).map((row) => String(row.id)));
}
