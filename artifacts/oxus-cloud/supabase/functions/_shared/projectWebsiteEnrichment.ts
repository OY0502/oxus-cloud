import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getFirecrawlConfig,
  isFirecrawlEnabled,
  firecrawlDisabledReason,
  mapUrl,
  prioritizeInternalUrls,
  scrapeUrl,
  type FirecrawlScrapedPage,
} from "./firecrawl.ts";
import { generateStructuredObject, oxusIdentityGuidance } from "./agent/aiModel.ts";
import { createLangfuseTrace, patchLangfuseTrace, buildLangfuseTraceUrl, type TraceMetadata } from "./agent/langfuse.ts";
import { executeCreateProposedTasks, executeUpdateProjectMemory } from "./agent/tools.ts";
import { buildSuppressedQuestionKeys, normalizeMemoryListKey } from "./memoryMerge.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** PART 7 — structured company enrichment extracted from website content only. */
export type CompanyEnrichmentExtraction = {
  company_name: string | null;
  logo_url: string | null;
  short_description: string | null;
  detailed_description: string | null;
  industry: string | null;
  product_type: string | null;
  target_users: string[];
  target_customers: string[];
  key_features: string[];
  positioning: string | null;
  use_cases: string[];
  business_model_notes: string | null;
  source_urls: string[];
  confidence: number;
  warnings: string[];
};

export type EnrichmentRunResult = {
  status: "succeeded" | "failed" | "skipped";
  reason?: string;
  message?: string;
  company_website_url?: string | null;
  pages_scraped: number;
  sources_created: number;
  sources_updated: number;
  sources_skipped_unchanged: number;
  initial_intelligence_generated: boolean;
  warnings: string[];
  langfuse_trace_url?: string;
  error?: string;
};

const MAX_TOTAL_PAGES = clampInt(Deno.env.get("FIRECRAWL_MAX_PAGES"), 10, 4, 12);
const MAX_CONTENT_CHARS = clampInt(Deno.env.get("FIRECRAWL_MAX_CONTENT_CHARS"), 60000, 10000, 200000);
const CHUNK_SIZE = clampInt(Deno.env.get("AI_CHUNK_SIZE_CHARS"), 10000, 1000, 40000);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function normalizeExtraction(raw: Record<string, unknown>): CompanyEnrichmentExtraction {
  return {
    company_name: asString(raw.company_name),
    logo_url: asString(raw.logo_url),
    short_description: asString(raw.short_description),
    detailed_description: asString(raw.detailed_description),
    industry: asString(raw.industry),
    product_type: asString(raw.product_type),
    target_users: asStringArray(raw.target_users),
    target_customers: asStringArray(raw.target_customers),
    key_features: asStringArray(raw.key_features),
    positioning: asString(raw.positioning),
    use_cases: asStringArray(raw.use_cases),
    business_model_notes: asString(raw.business_model_notes),
    source_urls: asStringArray(raw.source_urls),
    confidence: clampConfidence(raw.confidence),
    warnings: asStringArray(raw.warnings),
  };
}

function pickLogoUrl(extraction: CompanyEnrichmentExtraction, homepage: FirecrawlScrapedPage | null): string | null {
  const candidates = [extraction.logo_url, homepage?.metadata.ogImage, homepage?.metadata.favicon];
  for (const c of candidates) {
    if (c && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Firecrawl scraping (exact company domain only)
// ---------------------------------------------------------------------------

async function scrapeCompanyWebsite(websiteUrl: string, warnings: string[]): Promise<FirecrawlScrapedPage[]> {
  const cfg = getFirecrawlConfig();
  const pages: FirecrawlScrapedPage[] = [];

  // 1) Homepage (required anchor for the exact company).
  const homepage = await scrapeUrl(websiteUrl, cfg);
  if (homepage) pages.push(homepage);
  else warnings.push(`Homepage returned no readable content: ${websiteUrl}`);

  // 2) Map same-domain internal pages, prioritize high-signal pages, scrape a few.
  const budgetForInternal = Math.max(0, MAX_TOTAL_PAGES - pages.length);
  if (budgetForInternal > 0) {
    const discovered = await mapUrl(websiteUrl, { limit: 40 }, cfg);
    const prioritized = prioritizeInternalUrls(websiteUrl, discovered, budgetForInternal);
    for (const url of prioritized) {
      if (pages.length >= MAX_TOTAL_PAGES) break;
      try {
        const page = await scrapeUrl(url, cfg);
        if (page && page.markdown) pages.push(page);
      } catch (e) {
        warnings.push(`Could not scrape ${url}: ${(e as Error).message}`);
      }
    }
  }

  return pages;
}

function buildCombinedContent(pages: FirecrawlScrapedPage[]): string {
  const parts = pages.map((p) => {
    const title = p.metadata.title ? `# ${p.metadata.title}\n` : "";
    return `Source URL: ${p.metadata.finalUrl ?? p.url}\n${title}${p.markdown}`.trim();
  });
  let combined = parts.join("\n\n---\n\n");
  if (combined.length > MAX_CONTENT_CHARS) combined = combined.slice(0, MAX_CONTENT_CHARS);
  return combined;
}

// ---------------------------------------------------------------------------
// Knowledge sources (dedupe via content hash; no duplicate sources)
// ---------------------------------------------------------------------------

async function upsertWebsiteKnowledgeSource(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  page: FirecrawlScrapedPage;
  isHomepage: boolean;
  websiteUrl: string;
  force: boolean;
}): Promise<"created" | "updated" | "skipped"> {
  const { admin, projectId, page } = args;
  const pageUrl = page.metadata.finalUrl ?? page.url;
  const title = page.metadata.title ?? pageUrl;
  const markdown = page.markdown;
  const contentHash = await sha256Hex(`${title}\n${markdown}`);
  const syncedAt = new Date().toISOString();
  const sourceType = args.isHomepage ? "company_website" : "company_website_page";

  const { data: existing } = await admin
    .from("project_knowledge_sources")
    .select("id, metadata, sync_status")
    .eq("project_id", projectId)
    .eq("external_provider", "firecrawl")
    .eq("external_id", pageUrl)
    .maybeSingle();

  const metadata = {
    source_type: sourceType,
    doc_title: title,
    source_url: pageUrl,
    website_url: args.websiteUrl,
    og_image: page.metadata.ogImage,
    favicon: page.metadata.favicon,
    description: page.metadata.description,
    language: page.metadata.language,
    content_hash: contentHash,
    synced_at: syncedAt,
  };

  if (existing?.id) {
    const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>;
    const unchanged = existingMeta.content_hash === contentHash;
    if (unchanged && !args.force) {
      await admin
        .from("project_knowledge_sources")
        .update({ sync_status: "active", last_synced_at: syncedAt })
        .eq("id", existing.id);
      return "skipped";
    }

    await admin
      .from("project_knowledge_sources")
      .update({
        source_type: sourceType,
        source_title: title,
        char_count: markdown.length,
        source_text: markdown,
        source_preview: markdown.slice(0, 1000),
        sync_status: "active",
        last_synced_at: syncedAt,
        metadata: { ...existingMeta, ...metadata },
      })
      .eq("id", existing.id);

    await replaceSourceChunks(admin, projectId, existing.id, title, markdown, sourceType);
    return "updated";
  }

  const { data: inserted, error } = await admin
    .from("project_knowledge_sources")
    .insert({
      project_id: projectId,
      source_type: sourceType,
      source_title: title,
      input_method: "api",
      external_provider: "firecrawl",
      external_id: pageUrl,
      char_count: markdown.length,
      source_text: markdown,
      source_preview: markdown.slice(0, 1000),
      sync_status: "active",
      last_synced_at: syncedAt,
      metadata,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await replaceSourceChunks(admin, projectId, inserted.id, title, markdown, sourceType);
  return "created";
}

async function replaceSourceChunks(
  admin: SupabaseClient,
  projectId: string,
  sourceId: string,
  title: string,
  markdown: string,
  sourceType: string,
): Promise<void> {
  await admin.from("project_knowledge_chunks").delete().eq("source_id", sourceId);
  const chunks = chunkText(markdown, CHUNK_SIZE);
  if (chunks.length === 0) return;
  const { error } = await admin.from("project_knowledge_chunks").insert(
    chunks.map((content, index) => ({
      project_id: projectId,
      source_id: sourceId,
      chunk_index: index,
      content,
      category: "company_website",
      metadata: { source_type: sourceType, doc_title: title, char_count: content.length },
    })),
  );
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// AI extraction (PART 7)
// ---------------------------------------------------------------------------

const EXTRACTION_SCHEMA = `Return strict JSON:
{
  "company_name": "string | null",
  "logo_url": "string | null",
  "short_description": "string | null",
  "detailed_description": "string | null",
  "industry": "string | null",
  "product_type": "string | null",
  "target_users": ["string"],
  "target_customers": ["string"],
  "key_features": ["string"],
  "positioning": "string | null",
  "use_cases": ["string"],
  "business_model_notes": "string | null",
  "source_urls": ["string"],
  "confidence": 0.0,
  "warnings": ["string"]
}`;

async function extractCompanyEnrichment(args: {
  combinedContent: string;
  websiteUrl: string;
  project: ProjectRow;
  proposalCompanyName: string | null;
  trace: TraceMetadata;
}): Promise<{ extraction: CompanyEnrichmentExtraction; model: string; traceId: string | null }> {
  const identity = oxusIdentityGuidance({
    projectName: args.project.name,
    clientName: args.project.client_name,
    projectType: args.project.project_type,
  });

  const nameHints = [args.project.client_name, args.proposalCompanyName, args.project.name]
    .filter((v): v is string => !!v && v.trim().length > 0);

  const { data, model, traceId } = await generateStructuredObject<Record<string, unknown>>({
    trace: { ...args.trace, prompt_type: "extractCompanyEnrichment", source_type: "company_website" },
    traceName: "extractCompanyEnrichment",
    schemaDescription: EXTRACTION_SCHEMA,
    systemPrompt: [
      "You extract structured company facts from a company's OWN website content.",
      "Use ONLY facts supported by the provided website content. Never invent facts.",
      "If a field is not supported by the content, use null or an empty array, and add a short note to warnings.",
      "Prefer exact website wording over generic assumptions.",
      "LANGUAGE: ALL output text MUST be written in natural English, regardless of the website's language.",
      "Every string in every field — short_description, detailed_description, industry, product_type, positioning, target_users, target_customers, key_features, use_cases, business_model_notes, warnings — must be in English.",
      "If the website is in another language (e.g. Norwegian, German, French), TRANSLATE the meaning into fluent English. Do NOT return the original-language text.",
      "Preserve ONLY proper nouns in their original form: company names, product names, brand names, and place names (e.g. specific locations). Everything descriptive around them must be English.",
      "company_name must come from the website content or the provided metadata hints — never guess a different company.",
      identity,
      "Output valid JSON only, with all text in English.",
    ].join(" "),
    userPrompt: [
      `Exact company website: ${args.websiteUrl}`,
      nameHints.length > 0 ? `Known name hints (from project/proposal metadata): ${nameHints.join(", ")}` : "",
      "",
      "Website content (scraped from the exact domain above only):",
      args.combinedContent,
      "",
      "Reminder: write EVERY output field in English. Translate any non-English source text; keep only proper nouns (company/product/place names) in their original form.",
    ].filter(Boolean).join("\n"),
  });

  return { extraction: normalizeExtraction(data), model, traceId };
}

// ---------------------------------------------------------------------------
// Initial Project Intelligence (PART 8)
// ---------------------------------------------------------------------------

type InitialIntelligence = {
  memory_updates: {
    business_goal: string | null;
    target_users: string[];
    scope_in: string[];
    scope_out: string[];
    success_criteria: string[];
    risks: string[];
    open_questions: string[];
    delivery_notes: string[];
  };
  proposed_tasks: Array<Record<string, unknown>>;
  clarification_questions: Array<{ question: string; reason: string | null; importance: string; blocks_task_creation: boolean }>;
  summary: string;
};

const INITIAL_PI_SCHEMA = `Return strict JSON:
{
  "memory_updates": {
    "business_goal": "string | null",
    "target_users": ["string"],
    "scope_in": ["string"],
    "scope_out": ["string"],
    "success_criteria": ["string"],
    "risks": ["string"],
    "open_questions": ["string"],
    "delivery_notes": ["string"]
  },
  "proposed_tasks": [
    { "title": "string", "description": "string", "priority": "low|medium|high|urgent", "acceptance_criteria": ["string"], "source_reason": "string" }
  ],
  "clarification_questions": [
    { "question": "string", "reason": "string", "importance": "low|medium|high", "blocks_task_creation": false }
  ],
  "summary": "string"
}`;

async function generateInitialIntelligence(args: {
  project: ProjectRow;
  requestMessage: string | null;
  extraction: CompanyEnrichmentExtraction | null;
  websiteUrl: string | null;
  proposalCompanyName: string | null;
  trace: TraceMetadata;
}): Promise<{ result: InitialIntelligence; model: string; traceId: string | null }> {
  const identity = oxusIdentityGuidance({
    projectName: args.project.name,
    clientName: args.project.client_name,
    projectType: args.project.project_type,
  });

  const backgroundContext = args.extraction
    ? [
      "Company website background context (NOT the scope — use only to understand who the client is):",
      `- Company: ${args.extraction.company_name ?? args.project.client_name ?? args.project.name}`,
      args.extraction.short_description ? `- What they do: ${args.extraction.short_description}` : "",
      args.extraction.industry ? `- Industry: ${args.extraction.industry}` : "",
      args.extraction.product_type ? `- Product type: ${args.extraction.product_type}` : "",
      args.extraction.positioning ? `- Positioning: ${args.extraction.positioning}` : "",
      args.extraction.target_users.length ? `- Their users: ${args.extraction.target_users.join(", ")}` : "",
      args.extraction.key_features.length ? `- Their features: ${args.extraction.key_features.slice(0, 10).join(", ")}` : "",
    ].filter(Boolean).join("\n")
    : "No company website enrichment available.";

  const projectMeta = [
    `Project name: ${args.project.name}`,
    args.project.client_name ? `Client: ${args.project.client_name}` : "",
    args.project.project_type ? `Project type: ${args.project.project_type}` : "",
    args.project.description ? `Existing project description: ${args.project.description}` : "",
    args.websiteUrl ? `Company website: ${args.websiteUrl}` : "",
  ].filter(Boolean).join("\n");

  const requestBlock = args.requestMessage
    ? `PRIMARY SIGNAL — the client's original request message (this defines what the client actually wants; base scope and tasks on THIS):\n${args.requestMessage}`
    : "No explicit client request message was provided. Derive an initial understanding cautiously from project metadata; do not fabricate scope from the website.";

  const { data, model, traceId } = await generateStructuredObject<Record<string, unknown>>({
    trace: { ...args.trace, prompt_type: "generateInitialProjectIntelligence" },
    traceName: "generateInitialProjectIntelligence",
    schemaDescription: INITIAL_PI_SCHEMA,
    systemPrompt: [
      "You are the OXUS Cloud project intelligence system creating the FIRST project memory for a new project.",
      "The client's request message is the STRONGEST signal for scope and tasks.",
      "Company website enrichment is BACKGROUND CONTEXT ONLY — it explains who the client is, not the project scope, unless it aligns with the request.",
      "Do NOT invent scope. Do NOT create fake tasks just because the website lists features.",
      "Only propose tasks that are real, actionable delivery work implied by the request message or clearly agreed scope.",
      "Ask at most 3 clarification questions — only genuinely important ones. Prefer fewer.",
      "If scope_out is only implied, keep it minimal.",
      identity,
      "Output valid JSON only.",
    ].join(" "),
    userPrompt: [
      requestBlock,
      "",
      projectMeta,
      "",
      backgroundContext,
    ].join("\n"),
  });

  const mem = (data.memory_updates ?? {}) as Record<string, unknown>;
  const result: InitialIntelligence = {
    memory_updates: {
      business_goal: asString(mem.business_goal),
      target_users: asStringArray(mem.target_users),
      scope_in: asStringArray(mem.scope_in),
      scope_out: asStringArray(mem.scope_out),
      success_criteria: asStringArray(mem.success_criteria),
      risks: asStringArray(mem.risks),
      open_questions: asStringArray(mem.open_questions),
      delivery_notes: asStringArray(mem.delivery_notes),
    },
    proposed_tasks: Array.isArray(data.proposed_tasks)
      ? (data.proposed_tasks as Array<Record<string, unknown>>).filter((t) => typeof t?.title === "string")
      : [],
    clarification_questions: (Array.isArray(data.clarification_questions) ? data.clarification_questions : [])
      .filter((q): q is Record<string, unknown> => !!q && typeof q === "object" && typeof (q as { question?: unknown }).question === "string")
      .slice(0, 3)
      .map((q) => ({
        question: String(q.question),
        reason: asString(q.reason),
        importance: ["low", "medium", "high"].includes(String(q.importance)) ? String(q.importance) : "medium",
        blocks_task_creation: q.blocks_task_creation === true,
      })),
    summary: asString(data.summary) ?? "Initial project intelligence generated.",
  };

  return { result, model, traceId };
}

async function persistInitialIntelligence(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  intelligence: InitialIntelligence;
  primarySourceId: string | null;
  model: string;
}): Promise<void> {
  const { admin, projectId, userId } = args;

  const { data: suppressedRows } = await admin
    .from("project_pm_attention_items")
    .select("question, status")
    .eq("project_id", projectId)
    .in("status", ["skipped", "cleared", "answered"]);
  const suppressedKeys = buildSuppressedQuestionKeys(suppressedRows ?? []);

  await executeUpdateProjectMemory({
    admin,
    projectId,
    userId,
    memoryUpdates: args.intelligence.memory_updates,
    sourceId: args.primarySourceId ?? undefined,
    suppressedQuestionKeys: suppressedKeys,
  });

  if (args.intelligence.proposed_tasks.length > 0) {
    await executeCreateProposedTasks({
      admin,
      projectId,
      userId,
      tasks: args.intelligence.proposed_tasks,
      sourceId: args.primarySourceId ?? undefined,
    });
  }

  // Attention items — dedupe against existing open + suppressed, max 3.
  const questions = args.intelligence.clarification_questions.slice(0, 3);
  if (questions.length > 0) {
    const { data: openRows } = await admin
      .from("project_pm_attention_items")
      .select("question_key")
      .eq("project_id", projectId)
      .eq("status", "open");
    const openKeys = new Set<string>((openRows ?? []).map((r) => String(r.question_key ?? "")).filter(Boolean));

    const rows = questions
      .filter((q) => {
        const key = normalizeMemoryListKey(q.question).slice(0, 200);
        return !suppressedKeys.has(normalizeMemoryListKey(q.question)) && !openKeys.has(key);
      })
      .map((q) => ({
        project_id: projectId,
        question: q.question,
        reason: q.reason,
        importance: q.importance,
        blocks_task_creation: q.blocks_task_creation,
        status: "open",
        source_knowledge_source_id: args.primarySourceId ?? null,
        question_key: normalizeMemoryListKey(q.question).slice(0, 200),
        created_by: userId,
        metadata: { origin: "initial_project_intelligence" },
      }));
    if (rows.length > 0) {
      await admin.from("project_pm_attention_items").insert(rows);
    }
  }

  await admin.from("ai_project_briefs").insert({
    project_id: projectId,
    source_type: "other",
    source_text: args.intelligence.summary || "Initial project intelligence from company website enrichment + request message.",
    summary: args.intelligence.summary,
    goals: args.intelligence.memory_updates.success_criteria,
    scope_in: args.intelligence.memory_updates.scope_in,
    scope_out: args.intelligence.memory_updates.scope_out,
    risks: args.intelligence.memory_updates.risks,
    open_questions: args.intelligence.memory_updates.open_questions,
    status: "completed",
    model: args.model,
    raw_response: { source_type: "initial_project_intelligence" },
    created_by: userId,
  });
}

// ---------------------------------------------------------------------------
// Project row + status helpers
// ---------------------------------------------------------------------------

type ProjectRow = {
  id: string;
  name: string;
  client_name: string | null;
  project_type: string | null;
  description: string | null;
  company_website_url: string | null;
  company_enrichment_metadata: Record<string, unknown> | null;
};

async function setEnrichmentStatus(
  admin: SupabaseClient,
  projectId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin.from("projects").update(patch).eq("id", projectId);
}

async function recordTimelineEvent(args: {
  admin: SupabaseClient;
  projectId: string;
  extraction: CompanyEnrichmentExtraction | null;
  websiteUrl: string;
  pagesScraped: number;
  traceUrl?: string;
}): Promise<void> {
  const name = args.extraction?.company_name ?? "company";
  await args.admin.from("project_timeline_events").insert({
    project_id: args.projectId,
    source_type: "company_website",
    source_table: "project_knowledge_sources",
    event_type: "project_company_enriched",
    event_title: "Company website enriched",
    event_summary: `Enriched ${name} from ${args.websiteUrl} (${args.pagesScraped} page${args.pagesScraped === 1 ? "" : "s"}).`,
    priority: "low",
    visibility: "internal",
    source_url: args.websiteUrl,
    metadata: {
      website_url: args.websiteUrl,
      pages_scraped: args.pagesScraped,
      industry: args.extraction?.industry ?? null,
      confidence: args.extraction?.confidence ?? null,
      langfuse_trace_url: args.traceUrl ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runProjectWebsiteEnrichment(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string;
  companyWebsiteUrl?: string | null;
  requestMessage?: string | null;
  proposalId?: string | null;
  force?: boolean;
}): Promise<EnrichmentRunResult> {
  const { admin, projectId, userId } = args;
  const warnings: string[] = [];
  const result: EnrichmentRunResult = {
    status: "succeeded",
    pages_scraped: 0,
    sources_created: 0,
    sources_updated: 0,
    sources_skipped_unchanged: 0,
    initial_intelligence_generated: false,
    warnings,
  };

  const { data: projectData, error: projectError } = await admin
    .from("projects")
    .select("id, name, client_name, project_type, description, company_website_url, company_enrichment_metadata")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !projectData) {
    return { ...result, status: "failed", error: projectError?.message ?? "Project not found." };
  }
  const project = projectData as ProjectRow;

  const providedUrl = normalizeWebsiteUrl(args.companyWebsiteUrl);
  const websiteUrl = providedUrl ?? normalizeWebsiteUrl(project.company_website_url);
  const requestMessage = (args.requestMessage ?? "").trim() || null;

  // Persist a provided URL even if we cannot enrich it.
  if (providedUrl && providedUrl !== project.company_website_url) {
    await setEnrichmentStatus(admin, projectId, { company_website_url: providedUrl });
  }

  // Nothing to do — no website and no request message.
  if (!websiteUrl && !requestMessage) {
    return { ...result, status: "skipped", reason: "no_website_or_request_message", message: "No company website or request message provided; nothing to enrich." };
  }

  const traceMeta: TraceMetadata = { project_id: projectId, source: "company_enrichment", source_type: "company_website" };
  const trace = await createLangfuseTrace({
    name: "enrichProjectFromWebsite",
    metadata: traceMeta,
    input: { website_url: websiteUrl, has_request_message: !!requestMessage, force: !!args.force },
  });
  const traceId = trace?.traceId ?? null;
  const traceUrl = buildLangfuseTraceUrl(traceId);
  if (traceUrl) result.langfuse_trace_url = traceUrl;

  // Safe diagnostics (PART 4): host only, never secrets.
  let supabaseHost = "unknown";
  try {
    supabaseHost = new URL(Deno.env.get("SUPABASE_URL") ?? "").host || "unknown";
  } catch {
    supabaseHost = "unknown";
  }
  console.info("[enrich-project-from-website] start", {
    project_id: projectId,
    supabase_host: supabaseHost,
    website_url: websiteUrl,
    has_request_message: !!requestMessage,
    force: !!args.force,
    firecrawl_enabled: isFirecrawlEnabled(),
    status_before: "queued",
  });

  await setEnrichmentStatus(admin, projectId, {
    company_enrichment_status: "running",
    company_enrichment_error: null,
  });

  let extraction: CompanyEnrichmentExtraction | null = null;
  let extractionModel = "";
  let primarySourceId: string | null = null;

  try {
    if (websiteUrl) {
      if (!isFirecrawlEnabled()) {
        warnings.push(firecrawlDisabledReason());
      } else {
        const pages = await scrapeCompanyWebsite(websiteUrl, warnings);
        result.pages_scraped = pages.length;

        if (pages.length === 0) {
          warnings.push("No pages could be scraped from the company website.");
        } else {
          for (let i = 0; i < pages.length; i += 1) {
            const outcome = await upsertWebsiteKnowledgeSource({
              admin,
              projectId,
              userId,
              page: pages[i],
              isHomepage: i === 0,
              websiteUrl,
              force: !!args.force,
            });
            if (outcome === "created") result.sources_created += 1;
            else if (outcome === "updated") result.sources_updated += 1;
            else result.sources_skipped_unchanged += 1;
          }

          // Track the homepage source as the primary source id for intelligence linkage.
          const { data: homepageSource } = await admin
            .from("project_knowledge_sources")
            .select("id")
            .eq("project_id", projectId)
            .eq("external_provider", "firecrawl")
            .eq("external_id", pages[0].metadata.finalUrl ?? pages[0].url)
            .maybeSingle();
          primarySourceId = homepageSource?.id ?? null;

          const combined = buildCombinedContent(pages);
          const proposalCompanyName = await loadProposalCompanyName(admin, args.proposalId);
          const extractionResult = await extractCompanyEnrichment({
            combinedContent: combined,
            websiteUrl,
            project,
            proposalCompanyName,
            trace: traceMeta,
          });
          extraction = extractionResult.extraction;
          extractionModel = extractionResult.model;
          warnings.push(...extraction.warnings);

          const logoUrl = pickLogoUrl(extraction, pages[0]);
          const enrichedDescription = extraction.detailed_description ?? extraction.short_description;

          const projectPatch: Record<string, unknown> = {
            company_logo_url: logoUrl,
            company_enriched_name: extraction.company_name,
            company_enriched_description: enrichedDescription,
            company_industry: extraction.industry,
            company_positioning: extraction.positioning,
            company_product_type: extraction.product_type,
            company_target_users: extraction.target_users,
            company_key_features: extraction.key_features,
            company_enriched_at: new Date().toISOString(),
            company_enrichment_metadata: {
              short_description: extraction.short_description,
              detailed_description: extraction.detailed_description,
              target_customers: extraction.target_customers,
              use_cases: extraction.use_cases,
              business_model_notes: extraction.business_model_notes,
              source_urls: extraction.source_urls.length ? extraction.source_urls : pages.map((p) => p.metadata.finalUrl ?? p.url),
              confidence: extraction.confidence,
              warnings: extraction.warnings,
              pages: pages.map((p) => ({ url: p.metadata.finalUrl ?? p.url, title: p.metadata.title })),
              model: extractionModel,
              langfuse_trace_url: traceUrl ?? null,
              enriched_at: new Date().toISOString(),
            },
          };

          // Do NOT overwrite a manually-edited project description; only fill when empty.
          if (!project.description?.trim() && enrichedDescription) {
            projectPatch.description = enrichedDescription;
          }

          await setEnrichmentStatus(admin, projectId, projectPatch);
          await recordTimelineEvent({ admin, projectId, extraction, websiteUrl, pagesScraped: pages.length, traceUrl });

          console.info("[enrich-project-from-website] extracted", {
            project_id: projectId,
            company_name: extraction.company_name,
            logo_found: !!logoUrl,
            description_length: (enrichedDescription ?? "").length,
            sources_created: result.sources_created,
            sources_updated: result.sources_updated,
            sources_skipped_unchanged: result.sources_skipped_unchanged,
            confidence: extraction.confidence,
          });
        }
      }
    }

    // Initial Project Intelligence — from request message (primary) + enrichment (background).
    const shouldGenerateInitial = await shouldGenerateInitialIntelligence(admin, projectId, requestMessage, extraction);
    if (shouldGenerateInitial) {
      const proposalCompanyName = await loadProposalCompanyName(admin, args.proposalId);
      const { result: intelligence, model } = await generateInitialIntelligence({
        project,
        requestMessage,
        extraction,
        websiteUrl,
        proposalCompanyName,
        trace: traceMeta,
      });
      try {
        await persistInitialIntelligence({
          admin,
          projectId,
          userId,
          intelligence,
          primarySourceId,
          model,
        });
        result.initial_intelligence_generated = true;
      } catch (memErr) {
        // PART 7: memory merge failure must NOT fail website enrichment.
        const memMessage = (memErr as Error).message;
        warnings.push(`Project Intelligence update failed: ${memMessage}`);
        console.warn("[enrich-project-from-website] initial intelligence failed", {
          project_id: projectId,
          error: memMessage.slice(0, 300),
        });
      }
    }

    // PART 6: if a website was provided but produced no usable data, this is a
    // failure for the user — never leave it "running" and never claim success.
    const websiteAttempted = !!websiteUrl;
    const websiteProducedData = !!extraction;
    const nowIso = new Date().toISOString();

    if (websiteAttempted && !websiteProducedData) {
      const readable = !isFirecrawlEnabled()
        ? firecrawlDisabledReason()
        : "No readable content could be scraped from the company website. Check the URL and try again.";
      await setEnrichmentStatus(admin, projectId, {
        company_enrichment_status: "failed",
        company_enrichment_error: readable,
        company_enriched_at: nowIso,
        company_enrichment_metadata: {
          website_url: websiteUrl,
          warnings,
          initial_intelligence_generated: result.initial_intelligence_generated,
          failed_reason: "no_website_data",
          langfuse_trace_url: traceUrl ?? null,
          enriched_at: nowIso,
        },
      });
      console.info("[enrich-project-from-website] finished", {
        project_id: projectId,
        status_after: "failed",
        reason: "no_website_data",
        initial_intelligence_generated: result.initial_intelligence_generated,
      });
      if (traceId) {
        await patchLangfuseTrace(traceId, { error: readable, metadata: traceMeta });
      }
      result.company_website_url = websiteUrl;
      return { ...result, status: "failed", error: readable };
    }

    await setEnrichmentStatus(admin, projectId, {
      company_enrichment_status: "succeeded",
      company_enrichment_error: null,
      company_enriched_at: nowIso,
    });

    if (traceId) {
      await patchLangfuseTrace(traceId, {
        output: {
          pages_scraped: result.pages_scraped,
          sources_created: result.sources_created,
          sources_updated: result.sources_updated,
          initial_intelligence_generated: result.initial_intelligence_generated,
        },
        metadata: traceMeta,
      });
    }

    console.info("[enrich-project-from-website] finished", {
      project_id: projectId,
      status_after: "succeeded",
      pages_scraped: result.pages_scraped,
      sources_created: result.sources_created,
      sources_updated: result.sources_updated,
      initial_intelligence_generated: result.initial_intelligence_generated,
    });

    result.company_website_url = websiteUrl;
    result.message = websiteUrl
      ? `Enriched from ${websiteUrl}.`
      : "Initial project intelligence generated from the request message.";
    return result;
  } catch (e) {
    const message = (e as Error).message;
    warnings.push(message);
    await setEnrichmentStatus(admin, projectId, {
      company_enrichment_status: "failed",
      company_enrichment_error: message.slice(0, 500),
      company_enriched_at: new Date().toISOString(),
    });
    console.info("[enrich-project-from-website] finished", {
      project_id: projectId,
      status_after: "failed",
      reason: "exception",
      error: message.slice(0, 300),
    });
    if (traceId) {
      await patchLangfuseTrace(traceId, { error: message.slice(0, 500), metadata: traceMeta });
    }
    return { ...result, status: "failed", error: message };
  }
}

async function shouldGenerateInitialIntelligence(
  admin: SupabaseClient,
  projectId: string,
  requestMessage: string | null,
  extraction: CompanyEnrichmentExtraction | null,
): Promise<boolean> {
  if (requestMessage) return true;
  if (!extraction) return false;
  // Only auto-seed memory from website background when no memory exists yet.
  const { data: existing } = await admin
    .from("project_pm_profiles")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();
  return !existing;
}

async function loadProposalCompanyName(
  admin: SupabaseClient,
  proposalId: string | null | undefined,
): Promise<string | null> {
  if (!proposalId) return null;
  const { data } = await admin.from("quotes").select("company").eq("id", proposalId).maybeSingle();
  return (data?.company as string | undefined)?.trim() || null;
}
