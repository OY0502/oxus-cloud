import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Globe, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { ProjectThumbnail } from "@/components/projects/ProjectThumbnail";
import { useEnrichProjectFromWebsite } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import type { ProjectWithAssignees } from "@/lib/types";

/** Company logo from Firecrawl enrichment, falling back to the project thumbnail. */
export function CompanyLogo({ project }: { project: ProjectWithAssignees }) {
  const [errored, setErrored] = useState(false);
  if (project.company_logo_url && !errored) {
    return (
      <img
        src={project.company_logo_url}
        alt={`${project.company_enriched_name ?? project.name} logo`}
        className="h-16 w-16 rounded-2xl object-contain bg-white border border-border/60 p-1.5"
        onError={() => setErrored(true)}
      />
    );
  }
  return <ProjectThumbnail name={project.name} imagePath={project.image_path} size="md" className="h-16 w-16 rounded-2xl" />;
}

/** Small status badge for the project header row. */
export function CompanyEnrichmentBadge({ project }: { project: ProjectWithAssignees }) {
  const status = project.company_enrichment_status;
  if (status === "queued" || status === "running") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-logo-blue/30 bg-logo-blue/10 text-logo-blue">
        <Loader2 className="h-3 w-3 animate-spin" /> Enriching company data
      </Badge>
    );
  }
  if (status === "succeeded") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-soft-green/30 bg-soft-green/10 text-soft-green">
        <Sparkles className="h-3 w-3" /> Website enriched
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] border-destructive/30 bg-destructive/10 text-destructive">
        <AlertCircle className="h-3 w-3" /> Enrichment failed
      </Badge>
    );
  }
  return null;
}

/** Enrichment is considered stale if it has been running/queued far longer than expected. */
const STALE_ENRICHMENT_MS = 3 * 60 * 1000;
function isEnrichmentStale(project: ProjectWithAssignees): boolean {
  const status = project.company_enrichment_status;
  if (status !== "queued" && status !== "running") return false;
  const updated = Date.parse(project.updated_at ?? "");
  if (Number.isNaN(updated)) return false;
  return Date.now() - updated > STALE_ENRICHMENT_MS;
}

function Chips({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 8).map((item, i) => (
          <Badge key={`${label}-${i}`} variant="secondary" className="text-[10px] font-normal">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Enriched company details + diagnostics + "Refresh website enrichment" action.
 * All enrichment happens server-side via the enrich-project-from-website Edge Function.
 */
export function CompanyEnrichmentDetails({ project }: { project: ProjectWithAssignees }) {
  const { toast } = useToast();
  const enrich = useEnrichProjectFromWebsite();

  const status = project.company_enrichment_status;
  const website = project.company_website_url?.trim() || null;
  const meta = (project.company_enrichment_metadata ?? {}) as Record<string, unknown>;
  const targetCustomers = Array.isArray(meta.target_customers)
    ? (meta.target_customers as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const hasEnrichedContent =
    !!project.company_enriched_description ||
    !!project.company_industry ||
    !!project.company_product_type ||
    !!project.company_positioning ||
    project.company_target_users.length > 0 ||
    project.company_key_features.length > 0 ||
    targetCustomers.length > 0;

  // Nothing relevant to show and no website to enrich.
  if (!website && !hasEnrichedContent && (status === "not_started" || status === "failed")) return null;

  const stale = isEnrichmentStale(project);

  const refresh = async () => {
    if (!website) return;
    try {
      const r = await enrich.mutateAsync({ project_id: project.id, company_website_url: website, force: true });
      if (!r.async && r.status === "failed") {
        toast({
          title: "Enrichment failed",
          description: r.message || "The company website could not be enriched.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: r.async ? "Enrichment queued" : "Enrichment refreshed",
        description: r.async
          ? "We're re-reading the company website in the background."
          : `Scraped ${r.pages_scraped ?? 0} page(s). Unchanged pages were skipped.`,
      });
    } catch (e) {
      toast({ title: "Refresh failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy = enrich.isPending || status === "queued" || status === "running";

  return (
    <section className="space-y-3 border-t border-border/70 pt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> Company
        </h3>
        {website && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={busy && !stale}
            onClick={() => void refresh()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy && !stale ? "animate-spin" : ""}`} />
            {stale ? "Retry enrichment" : busy ? "Enriching…" : "Refresh website enrichment"}
          </Button>
        )}
      </div>

      {stale && (
        <Alert className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-xs">Still enriching…</AlertTitle>
          <AlertDescription className="text-xs">
            This is taking longer than expected. You can wait or use Retry enrichment.
          </AlertDescription>
        </Alert>
      )}

      {website && (
        <a
          href={website}
          target="_blank"
          rel="noreferrer noopener"
          className="block w-fit max-w-full text-xs text-logo-blue underline underline-offset-2 break-all"
        >
          {website}
        </a>
      )}

      {(project.company_industry || project.company_product_type) && (
        <div className="flex flex-wrap gap-1.5">
          {project.company_industry && (
            <Badge variant="outline" className="text-[10px]">{project.company_industry}</Badge>
          )}
          {project.company_product_type && (
            <Badge variant="outline" className="text-[10px]">{project.company_product_type}</Badge>
          )}
        </div>
      )}

      {project.company_enriched_description && !project.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{project.company_enriched_description}</p>
      )}

      {project.company_positioning && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Positioning</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{project.company_positioning}</p>
        </div>
      )}

      <Chips label="Target customers" items={targetCustomers} />
      <Chips label="Target users" items={project.company_target_users} />
      <Chips label="Key features" items={project.company_key_features} />

      {status === "failed" && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-xs">Website enrichment failed</AlertTitle>
          <AlertDescription className="text-xs">
            {project.company_enrichment_error || "The company website could not be enriched."}
            {website ? " Check the URL and try Refresh." : " Add a company website in Edit to retry."}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
