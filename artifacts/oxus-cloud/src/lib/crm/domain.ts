import { parse } from "tldts";

export type ParsedDomain = {
  original: string;
  normalizedHost: string;
  registrableDomain: string | null;
  subdomain: string | null;
  websiteUrl: string | null;
  isValid: boolean;
};

export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let host = raw.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "");
  host = host.replace(/^www\./, "");
  host = host.split("/")[0] ?? host;
  host = host.split(":")[0] ?? host;
  host = host.replace(/\.$/, "");
  return host || null;
}

export function parseDomainInput(input: string | null | undefined): ParsedDomain {
  const original = (input ?? "").trim();
  if (!original) {
    return {
      original: "",
      normalizedHost: "",
      registrableDomain: null,
      subdomain: null,
      websiteUrl: null,
      isValid: false,
    };
  }

  const normalizedHost = normalizeHost(original) ?? "";
  const parsed = parse(normalizedHost, { allowPrivateDomains: false });
  const registrableDomain = parsed.domain && parsed.isIcann
    ? parsed.domain
    : normalizedHost.includes(".") ? normalizedHost : null;

  let subdomain: string | null = null;
  if (registrableDomain && normalizedHost !== registrableDomain) {
    subdomain = normalizedHost.slice(0, -(registrableDomain.length + 1)) || null;
  }

  const websiteUrl = registrableDomain ? `https://${registrableDomain}` : null;

  return {
    original,
    normalizedHost,
    registrableDomain,
    subdomain,
    websiteUrl,
    isValid: !!registrableDomain,
  };
}

export function extractRegistrableDomainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return parseDomainInput(email.slice(at + 1)).registrableDomain;
}

export function domainsEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = parseDomainInput(a ?? "").registrableDomain;
  const db = parseDomainInput(b ?? "").registrableDomain;
  return !!da && !!db && da === db;
}
