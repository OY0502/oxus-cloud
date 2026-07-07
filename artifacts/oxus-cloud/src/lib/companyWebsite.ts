/**
 * Light client-side URL check for the company website field. Real validation and
 * normalization happen server-side in the enrichment Edge Function — the browser
 * NEVER calls Firecrawl directly.
 */
export function isLikelyWebsiteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}
