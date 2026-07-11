// Client-side internal access helpers (UX only — enforced server-side via RLS + Edge Functions).

export const INTERNAL_EMAIL_DOMAIN = "oxus.agency";

export const INTERNAL_ACCESS_MESSAGE =
  "OXUS Cloud is an internal tool. Please use your @oxus.agency email.";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseClientAllowlist(): Set<string> {
  const raw = import.meta.env.VITE_AUTH_EMAIL_ALLOWLIST as string | undefined;
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean),
  );
}

const clientAllowlist = parseClientAllowlist();

export function hasInternalOxusDomain(email: string): boolean {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at < 1) return false;
  return normalized.slice(at + 1) === INTERNAL_EMAIL_DOMAIN;
}

/** UX pre-check before submit; server enforces the real policy. */
export function isAllowedInternalEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) return false;
  if (hasInternalOxusDomain(normalized)) return true;
  return clientAllowlist.has(normalized);
}
