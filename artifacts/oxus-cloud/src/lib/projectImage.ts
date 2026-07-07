import { supabase } from "@/lib/supabase";

const DOCUMENTS_BUCKET = "documents";

/** Deterministic placeholder when a project has no uploaded image. */
export function projectImagePlaceholder(name: string): string {
  const label = encodeURIComponent(name.trim() || "Project");
  return `https://ui-avatars.com/api/?name=${label}&size=128&background=e2e8f0&color=475569&bold=true`;
}

export async function getProjectImageUrl(imagePath: string | null | undefined): Promise<string | null> {
  if (!imagePath) return null;
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(imagePath, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function uploadProjectImage(projectId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `project-images/${projectId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (upErr) throw new Error(upErr.message);
  return path;
}

export async function removeProjectImage(imagePath: string): Promise<void> {
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([imagePath]);
}
