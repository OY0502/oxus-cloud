/**
 * Server-side company logo resolution with SSRF protection.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseDomainInput } from "./crm/domain.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const PRIVATE_IP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/;

export type LogoResolveResult = {
  status: "resolved" | "fallback_favicon" | "initials" | "failed" | "skipped";
  logo_url: string | null;
  logo_storage_path: string | null;
  logo_source: string | null;
  logo_source_url: string | null;
  logo_confidence: number | null;
  logo_width: number | null;
  logo_height: number | null;
  logo_content_hash: string | null;
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

async function fetchImageSafe(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isSafePublicUrl(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "image/*" },
      redirect: "follow",
    });
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

function faviconCandidates(domain: string): string[] {
  return [
    `https://${domain}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ];
}

export async function resolveCompanyLogo(
  admin: SupabaseClient,
  args: { companyId: string; domain: string; websiteUrl?: string | null; forceRefresh?: boolean },
): Promise<LogoResolveResult> {
  const { data: company } = await admin
    .from("clients")
    .select("id, manual_logo_locked, logo_url, logo_status, registrable_domain, primary_domain")
    .eq("id", args.companyId)
    .maybeSingle();

  if (!company) return { status: "failed", logo_url: null, logo_storage_path: null, logo_source: null, logo_source_url: null, logo_confidence: null, logo_width: null, logo_height: null, logo_content_hash: null };
  if (company.manual_logo_locked && company.logo_url) {
    return { status: "skipped", logo_url: company.logo_url, logo_storage_path: null, logo_source: "manual_locked", logo_source_url: null, logo_confidence: 1, logo_width: null, logo_height: null, logo_content_hash: null };
  }

  const parsed = parseDomainInput(args.domain || company.registrable_domain || company.primary_domain || "");
  const domain = parsed.registrableDomain;
  if (!domain) {
    return { status: "initials", logo_url: null, logo_storage_path: null, logo_source: "initials", logo_source_url: null, logo_confidence: 0.2, logo_width: null, logo_height: null, logo_content_hash: null };
  }

  for (const candidate of faviconCandidates(domain)) {
    const img = await fetchImageSafe(candidate);
    if (!img) continue;

    const ext = img.contentType.includes("png") ? "png" : img.contentType.includes("webp") ? "webp" : "jpg";
    const path = `${args.companyId}/logo.${ext}`;
    const { error } = await admin.storage.from("company-logos").upload(path, img.bytes, {
      contentType: img.contentType,
      upsert: true,
    });
    if (error) continue;

    const { data: pub } = admin.storage.from("company-logos").getPublicUrl(path);
    const isFavicon = candidate.includes("favicon");
    return {
      status: isFavicon ? "fallback_favicon" : "resolved",
      logo_url: pub.publicUrl,
      logo_storage_path: path,
      logo_source: isFavicon ? "favicon" : "explicit",
      logo_source_url: candidate,
      logo_confidence: isFavicon ? 0.45 : 0.7,
      logo_width: null,
      logo_height: null,
      logo_content_hash: null,
    };
  }

  return { status: "initials", logo_url: null, logo_storage_path: null, logo_source: "initials", logo_source_url: null, logo_confidence: 0.2, logo_width: null, logo_height: null, logo_content_hash: null };
}
