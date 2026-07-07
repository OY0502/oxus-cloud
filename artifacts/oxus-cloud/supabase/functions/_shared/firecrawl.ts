// Server-only Firecrawl client (Deno / Supabase Edge Functions + Trigger.dev workers).
// SECURITY: FIRECRAWL_API_KEY must NEVER be exposed to the browser. Do not prefix
// with VITE_. This module is only imported from server-side code.

export type FirecrawlConfig = {
  apiKey: string;
  apiUrl: string;
};

export type FirecrawlPageMetadata = {
  title: string | null;
  description: string | null;
  language: string | null;
  ogImage: string | null;
  favicon: string | null;
  sourceUrl: string | null;
  finalUrl: string | null;
  statusCode: number | null;
};

export type FirecrawlScrapedPage = {
  url: string;
  markdown: string;
  metadata: FirecrawlPageMetadata;
};

export function isFirecrawlEnabled(): boolean {
  return !!Deno.env.get("FIRECRAWL_API_KEY")?.trim();
}

export function firecrawlDisabledReason(): string {
  return "FIRECRAWL_API_KEY is not set. Add it to Supabase secrets and the Trigger.dev environment.";
}

export function getFirecrawlConfig(): FirecrawlConfig {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY")?.trim();
  if (!apiKey) throw new Error(firecrawlDisabledReason());
  const apiUrl = (Deno.env.get("FIRECRAWL_API_URL") ?? "https://api.firecrawl.dev").replace(/\/+$/, "");
  return { apiKey, apiUrl };
}

/** Firecrawl metadata fields can be a string or an array of strings. */
function metaString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim());
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

function metaNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function parseMetadata(raw: Record<string, unknown> | undefined, requestedUrl: string): FirecrawlPageMetadata {
  const meta = raw ?? {};
  return {
    title: metaString(meta.title),
    description: metaString(meta.description),
    language: metaString(meta.language),
    ogImage: metaString(meta.ogImage) ?? metaString(meta["og:image"]),
    favicon: metaString(meta.favicon),
    sourceUrl: metaString(meta.sourceURL) ?? requestedUrl,
    finalUrl: metaString(meta.url) ?? metaString(meta.sourceURL) ?? requestedUrl,
    statusCode: metaNumber(meta.statusCode),
  };
}

async function firecrawlFetch(
  path: string,
  body: Record<string, unknown>,
  cfg: FirecrawlConfig,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${cfg.apiUrl}/v2/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Firecrawl ${path} failed (${response.status}): ${text.slice(0, 600)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Firecrawl ${path} returned non-JSON: ${text.slice(0, 400)}`);
  }
}

/** Scrape a single URL to clean markdown + metadata. Returns null when the page has no usable content. */
export async function scrapeUrl(url: string, cfg?: FirecrawlConfig): Promise<FirecrawlScrapedPage | null> {
  const config = cfg ?? getFirecrawlConfig();
  const parsed = await firecrawlFetch(
    "scrape",
    {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      // Conservative timeout so a slow page doesn't stall the whole enrichment.
      timeout: 45000,
    },
    config,
  );

  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const markdown = typeof data.markdown === "string" ? data.markdown.trim() : "";
  const metadata = parseMetadata(data.metadata as Record<string, unknown> | undefined, url);
  if (!markdown) return null;
  return { url, markdown, metadata };
}

function sameRegistrableHost(a: string, b: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return norm(a) === norm(b);
}

/**
 * Discover a small set of same-domain internal URLs. External domains are always
 * dropped. Returns absolute URLs (deduped, homepage first).
 */
export async function mapUrl(
  url: string,
  opts: { search?: string; limit?: number } = {},
  cfg?: FirecrawlConfig,
): Promise<string[]> {
  const config = cfg ?? getFirecrawlConfig();
  let baseHost: string;
  try {
    baseHost = new URL(url).host;
  } catch {
    return [];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = await firecrawlFetch(
      "map",
      {
        url,
        limit: opts.limit ?? 40,
        includeSubdomains: false,
        sitemap: "include",
        ...(opts.search ? { search: opts.search } : {}),
      },
      config,
    );
  } catch (e) {
    // Map is best-effort; homepage scrape still works without it.
    console.warn("[firecrawl] map failed:", (e as Error).message);
    return [];
  }

  const rawLinks = Array.isArray(parsed.links) ? parsed.links : [];
  const urls: string[] = [];
  for (const entry of rawLinks) {
    let candidate: string | null = null;
    if (typeof entry === "string") candidate = entry;
    else if (entry && typeof entry === "object" && typeof (entry as { url?: unknown }).url === "string") {
      candidate = (entry as { url: string }).url;
    }
    if (!candidate) continue;
    try {
      const parsedUrl = new URL(candidate);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") continue;
      if (!sameRegistrableHost(parsedUrl.host, baseHost)) continue;
      urls.push(parsedUrl.toString());
    } catch {
      // ignore malformed links
    }
  }
  return [...new Set(urls)];
}

// Priority path keywords (order = priority). Homepage handled separately.
const PRIORITY_PAGE_KEYWORDS = [
  "about",
  "product",
  "products",
  "features",
  "solutions",
  "platform",
  "pricing",
  "customers",
  "case-stud",
  "use-case",
  "use-cases",
  "services",
  "contact",
];

const DEPRIORITIZED_KEYWORDS = ["blog", "news", "press", "career", "jobs", "privacy", "terms", "legal", "cookie"];

/** Rank discovered internal URLs so we crawl the highest-signal pages within the budget. */
export function prioritizeInternalUrls(homepageUrl: string, urls: string[], maxPages: number): string[] {
  let homeHost = "";
  try {
    homeHost = new URL(homepageUrl).host;
  } catch {
    // ignore
  }

  const scored = urls
    .filter((u) => {
      try {
        const p = new URL(u);
        // Drop the homepage itself (scraped separately) and any off-domain link.
        if (homeHost && p.host.toLowerCase().replace(/^www\./, "") !== homeHost.toLowerCase().replace(/^www\./, "")) {
          return false;
        }
        const path = p.pathname.replace(/\/+$/, "");
        return path.length > 1; // exclude "/" homepage
      } catch {
        return false;
      }
    })
    .map((u) => {
      const lower = u.toLowerCase();
      let score = 0;
      PRIORITY_PAGE_KEYWORDS.forEach((kw, i) => {
        if (lower.includes(`/${kw}`) || lower.includes(`${kw}`)) score += PRIORITY_PAGE_KEYWORDS.length - i;
      });
      if (DEPRIORITIZED_KEYWORDS.some((kw) => lower.includes(kw))) score -= 50;
      // Prefer shallow paths.
      const depth = (u.match(/\//g)?.length ?? 0);
      score -= depth;
      return { url: u, score };
    })
    .sort((a, b) => b.score - a.score);

  // Only keep pages with at least some positive signal; fall back to shallow pages
  // if nothing matched, but never blog/news unless there is no better content.
  const positive = scored.filter((s) => s.score > 0).map((s) => s.url);
  const chosen = positive.length > 0 ? positive : scored.map((s) => s.url);
  return chosen.slice(0, Math.max(0, maxPages));
}
