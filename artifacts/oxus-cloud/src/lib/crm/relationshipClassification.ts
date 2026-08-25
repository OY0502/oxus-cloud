import type { CompanyType } from "@/lib/types";

export type ClassificationEvidence = {
  hasActiveProject?: boolean;
  hasCompletedProject?: boolean;
  hasPaidInvoice?: boolean;
  hasSentInvoice?: boolean;
  hasOpenProposal?: boolean;
  hasOpenLead?: boolean;
  isKnownPlatform?: boolean;
  isInfrastructure?: boolean;
  manuallyClassified?: CompanyType;
  twoWayCommunication?: boolean;
};

export type ResolvedRelationship = {
  companyType: CompanyType;
  confidence: number;
  evidence: string[];
};

const PLATFORM_DOMAINS = new Set([
  "hubspot.com", "stripe.com", "firecrawl.dev", "github.com", "slack.com",
  "notion.so", "vercel.com", "supabase.com", "clickup.com", "pandadoc.com",
  "google.com", "microsoft.com", "openrouter.ai", "langfuse.com", "intercom.io",
  "bubble.io", "upwork.com", "retool.com",
]);

export function classifyCompanyRelationship(
  registrableDomain: string | null,
  evidence: ClassificationEvidence,
): ResolvedRelationship {
  if (evidence.manuallyClassified) {
    return {
      companyType: evidence.manuallyClassified,
      confidence: 1,
      evidence: ["manually_classified"],
    };
  }

  const hits: string[] = [];

  if (evidence.hasPaidInvoice || evidence.hasSentInvoice) {
    hits.push(evidence.hasPaidInvoice ? "paid_invoice" : "sent_invoice");
    return { companyType: "client", confidence: 0.95, evidence: hits };
  }
  if (evidence.hasActiveProject || evidence.hasCompletedProject) {
    hits.push(evidence.hasActiveProject ? "active_project" : "completed_project");
    return { companyType: "client", confidence: 0.92, evidence: hits };
  }
  if (evidence.hasOpenProposal || evidence.hasOpenLead) {
    hits.push(evidence.hasOpenProposal ? "open_proposal" : "open_lead");
    return { companyType: "prospect", confidence: 0.85, evidence: hits };
  }
  if (evidence.isInfrastructure || evidence.isKnownPlatform) {
    hits.push(evidence.isInfrastructure ? "infrastructure_domain" : "known_platform");
    return { companyType: "tool", confidence: 0.8, evidence: hits };
  }
  if (registrableDomain && PLATFORM_DOMAINS.has(registrableDomain)) {
    hits.push("platform_domain");
    return { companyType: "tool", confidence: 0.75, evidence: hits };
  }
  if (evidence.twoWayCommunication) {
    hits.push("two_way_communication");
    return { companyType: "prospect", confidence: 0.55, evidence: hits };
  }

  return { companyType: "unknown", confidence: 0.3, evidence: ["insufficient_evidence"] };
}

export function mapLegacyCompanyType(type: string | null | undefined): CompanyType {
  if (!type) return "prospect";
  const normalized = type.toLowerCase();
  if (normalized === "tool" || normalized === "tool_or_platform") return "vendor";
  if (normalized === "unknown") return "prospect";
  const allowed: CompanyType[] = ["internal", "client", "prospect", "partner", "vendor", "inactive"];
  return allowed.includes(normalized as CompanyType) ? normalized as CompanyType : "prospect";
}
