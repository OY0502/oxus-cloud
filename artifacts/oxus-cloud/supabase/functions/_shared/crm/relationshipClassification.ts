import { KNOWN_PLATFORM_DOMAINS } from "./senderClassification.ts";

export type CompanyType =
  | "internal"
  | "client"
  | "prospect"
  | "partner"
  | "vendor"
  | "tool"
  | "unknown"
  | "inactive";

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
  isInternal?: boolean;
};

export type ResolvedRelationship = {
  companyType: CompanyType;
  confidence: number;
  evidence: string[];
};

export function classifyCompanyRelationship(
  registrableDomain: string | null,
  evidence: ClassificationEvidence,
): ResolvedRelationship {
  if (evidence.manuallyClassified) {
    return { companyType: evidence.manuallyClassified, confidence: 1, evidence: ["manually_classified"] };
  }

  if (evidence.isInternal) {
    return { companyType: "internal", confidence: 1, evidence: ["internal_domain"] };
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
  if (evidence.isInfrastructure) {
    hits.push("infrastructure_domain");
    return { companyType: "tool", confidence: 0.85, evidence: hits };
  }
  if (evidence.isKnownPlatform || (registrableDomain && KNOWN_PLATFORM_DOMAINS.has(registrableDomain))) {
    hits.push("known_platform");
    return { companyType: "tool", confidence: 0.8, evidence: hits };
  }
  if (evidence.twoWayCommunication) {
    hits.push("two_way_communication");
    return { companyType: "prospect", confidence: 0.55, evidence: hits };
  }

  return { companyType: "unknown", confidence: 0.3, evidence: ["insufficient_evidence"] };
}
