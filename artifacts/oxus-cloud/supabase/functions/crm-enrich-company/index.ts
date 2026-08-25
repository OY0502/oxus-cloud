import { getServiceRoleSupabase } from "../_shared/google-auth.ts";
import {
  getFirecrawlConfig,
  isFirecrawlEnabled,
  scrapeUrl,
} from "../_shared/firecrawl.ts";
import { generateStructuredObject, oxusIdentityGuidance } from "../_shared/agent/aiModel.ts";
import { createLangfuseTrace, patchLangfuseTrace } from "../_shared/agent/langfuse.ts";
import { normalizeWebsiteUrl } from "../_shared/projectWebsiteEnrichment.ts";
import { canOverwriteField } from "../_shared/crmEntityResolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-role-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function isAuthorized(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
  return !!serviceKey && auth === serviceKey;
}

type CompanyEnrichment = {
  name: string | null;
  description: string | null;
  industry: string | null;
  logo_url: string | null;
  headquarters: string | null;
  country: string | null;
  city: string | null;
  products_services: string | null;
  confidence: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!isAuthorized(req)) return json({ error: "Unauthorized." }, 401);

  try {
    const body = await req.json() as { company_id?: string; website?: string | null };
    if (!body.company_id) return json({ error: "company_id required." }, 400);

    const admin = getServiceRoleSupabase();
    const { data: company } = await admin.from("clients").select("*").eq("id", body.company_id).single();
    if (!company) return json({ error: "Company not found." }, 404);

    const website = normalizeWebsiteUrl(body.website ?? company.website);
    if (!website) return json({ status: "skipped", reason: "no_website" });
    if (!isFirecrawlEnabled()) return json({ status: "skipped", reason: "firecrawl_disabled" });

    await admin.from("clients").update({ enrichment_status: "running" }).eq("id", body.company_id);

    const trace = await createLangfuseTrace({
      name: "crm-enrich-company",
      metadata: { company_id: body.company_id, website, source: "firecrawl" },
    });

    const scraped = await scrapeUrl(website, getFirecrawlConfig());
    const content = scraped?.content?.slice(0, 30000) ?? "";

    const { data: extraction } = await generateStructuredObject<CompanyEnrichment>({
      schemaDescription: `Return JSON: name, description, industry, logo_url, headquarters, country, city, products_services, confidence (0-1). Only facts from content.`,
      systemPrompt: `${oxusIdentityGuidance()}\nExtract public company profile fields only.`,
      userPrompt: `Website: ${website}\n\nContent:\n${content}`,
      trace: { company_id: body.company_id },
      traceName: "crm-company-enrichment",
    });

    const provenance = (company.field_provenance ?? {}) as Record<string, { source: string; updated_at: string }>;
    const locked = (company.locked_fields ?? []) as string[];
    const patch: Record<string, unknown> = {
      enrichment_status: "succeeded",
      last_enriched_at: new Date().toISOString(),
      enrichment_confidence: extraction.confidence,
      enrichment_sources: [{ type: "firecrawl", url: website, at: new Date().toISOString() }],
    };

    const fieldMap: Record<string, keyof CompanyEnrichment> = {
      name: "name",
      description: "description",
      industry: "industry",
      logo_url: "logo_url",
      headquarters: "headquarters",
      country: "country",
      city: "city",
      products_services: "products_services",
    };

    for (const [col, key] of Object.entries(fieldMap)) {
      const value = extraction[key];
      if (value && canOverwriteField(locked, col, provenance, "firecrawl")) {
        patch[col] = value;
        provenance[col] = { source: "firecrawl", updated_at: new Date().toISOString() };
      }
    }
    patch.field_provenance = provenance;
    if (!company.primary_domain) {
      try {
        patch.primary_domain = new URL(website).hostname.replace(/^www\./, "");
      } catch { /* ignore */ }
    }

    await admin.from("clients").update(patch).eq("id", body.company_id);
    if (trace) await patchLangfuseTrace(trace.traceId, { output: { status: "succeeded", confidence: extraction.confidence } });

    return json({ status: "succeeded", company_id: body.company_id, extraction });
  } catch (e) {
    console.error("[crm-enrich-company]", (e as Error).message);
    return json({ status: "failed", error: (e as Error).message }, 500);
  }
});
