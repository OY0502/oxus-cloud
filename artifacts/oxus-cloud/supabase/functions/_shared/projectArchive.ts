import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const PROJECT_ARCHIVED_SKIP_MESSAGE =
  "Project is archived. Automatic processing skipped.";

export async function getProjectArchiveState(
  admin: SupabaseClient,
  projectId: string,
): Promise<{ id: string; name: string; archived_at: string | null } | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id, name, archived_at")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export function isProjectArchived(row: { archived_at?: string | null } | null | undefined): boolean {
  return !!row?.archived_at;
}
