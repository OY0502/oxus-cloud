/**
 * Server-side person photo resolution (Google Contact photos → Supabase Storage).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_BYTES = 2 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const PRIVATE_IP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/;

export type PersonPhotoResult = {
  status: "resolved" | "fallback" | "failed" | "skipped";
  avatar_url: string | null;
  photo_storage_path: string | null;
  photo_source: string | null;
};

function isSafePublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return false;
    if (PRIVATE_IP.test(host)) return false;
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchImageSafe(url: string, accessToken?: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isSafePublicUrl(url) && !url.startsWith("https://lh3.googleusercontent.com")) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = { Accept: "image/*" };
    if (accessToken && url.includes("googleusercontent.com")) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const resp = await fetch(url, { signal: controller.signal, headers, redirect: "follow" });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    if (contentType.includes("svg")) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength > MAX_BYTES || buf.byteLength < 32) return null;
    return { bytes: buf, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolvePersonPhotoFromGoogle(
  admin: SupabaseClient,
  args: { personId: string; photoUrl?: string | null; accessToken?: string },
): Promise<PersonPhotoResult> {
  const { data: person } = await admin
    .from("contacts")
    .select("id, avatar_url, manually_confirmed, photo_status")
    .eq("id", args.personId)
    .maybeSingle();

  if (!person) {
    return { status: "failed", avatar_url: null, photo_storage_path: null, photo_source: null };
  }
  if (person.manually_confirmed && person.avatar_url) {
    return { status: "skipped", avatar_url: person.avatar_url, photo_storage_path: null, photo_source: "manual" };
  }
  if (!args.photoUrl) {
    await admin.from("contacts").update({ photo_status: "fallback" }).eq("id", args.personId);
    return { status: "fallback", avatar_url: null, photo_storage_path: null, photo_source: "initials" };
  }

  const img = await fetchImageSafe(args.photoUrl, args.accessToken);
  if (!img) {
    await admin.from("contacts").update({ photo_status: "failed" }).eq("id", args.personId);
    return { status: "failed", avatar_url: null, photo_storage_path: null, photo_source: null };
  }

  const ext = img.contentType.includes("png") ? "png" : img.contentType.includes("webp") ? "webp" : "jpg";
  const path = `${args.personId}/photo.${ext}`;
  const { error } = await admin.storage.from("person-photos").upload(path, img.bytes, {
    contentType: img.contentType,
    upsert: true,
  });
  if (error) {
    await admin.from("contacts").update({ photo_status: "failed" }).eq("id", args.personId);
    return { status: "failed", avatar_url: null, photo_storage_path: null, photo_source: null };
  }

  const { data: pub } = admin.storage.from("person-photos").getPublicUrl(path);
  await admin.from("contacts").update({
    avatar_url: pub.publicUrl,
    photo_storage_path: path,
    photo_source: "google_contact",
    photo_status: "resolved",
  }).eq("id", args.personId);

  return {
    status: "resolved",
    avatar_url: pub.publicUrl,
    photo_storage_path: path,
    photo_source: "google_contact",
  };
}
