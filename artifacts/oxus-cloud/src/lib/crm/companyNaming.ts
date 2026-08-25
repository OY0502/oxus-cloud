import { parseDomainInput } from "./domain";
import { isInfrastructureHost, shouldCreateCompanyFromDomain } from "./senderClassification";

export type CompanyNameSource =
  | "manual"
  | "project"
  | "invoice"
  | "crm_existing"
  | "google_contact_org"
  | "website_structured"
  | "website_title"
  | "email_signature"
  | "domain_derived"
  | "unknown";

export type ResolvedCompanyName = {
  displayName: string;
  normalizedName: string;
  confidence: number;
  source: CompanyNameSource;
  shouldSuppress: boolean;
  registrableDomain: string | null;
};

const LEGAL_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|gmbh|ag|sa|srl|bv|pty|co)\b\.?$/i;

function titleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function domainStemToCandidate(domain: string): string {
  const parsed = parseDomainInput(domain);
  const registrable = parsed.registrableDomain ?? domain;
  const stem = registrable.split(".")[0] ?? registrable;
  if (!stem || stem.length < 2) return registrable;
  if (/^[a-z]{2,4}$/i.test(stem)) return stem.toUpperCase();
  return titleCaseWords(stem.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

export function resolveCompanyName(args: {
  domain: string;
  manuallyConfirmed?: boolean;
  confirmedName?: string | null;
  existingCrmName?: string | null;
  googleOrgName?: string | null;
  websiteOrgName?: string | null;
  websiteTitle?: string | null;
  signatureOrg?: string | null;
}): ResolvedCompanyName {
  const parsed = parseDomainInput(args.domain);
  const registrableDomain = parsed.registrableDomain;

  if (!registrableDomain || !shouldCreateCompanyFromDomain(args.domain)) {
    return {
      displayName: args.confirmedName?.trim() || domainStemToCandidate(args.domain),
      normalizedName: (args.confirmedName ?? domainStemToCandidate(args.domain)).toLowerCase(),
      confidence: 0.15,
      source: "unknown",
      shouldSuppress: isInfrastructureHost(args.domain),
      registrableDomain,
    };
  }

  if (args.manuallyConfirmed && args.confirmedName?.trim()) {
    const name = args.confirmedName.trim();
    return {
      displayName: name,
      normalizedName: name.toLowerCase().replace(LEGAL_SUFFIXES, "").trim(),
      confidence: 1,
      source: "manual",
      shouldSuppress: false,
      registrableDomain,
    };
  }

  const candidates: Array<{ name: string; confidence: number; source: CompanyNameSource }> = [];

  if (args.existingCrmName?.trim()) {
    candidates.push({ name: args.existingCrmName.trim(), confidence: 0.98, source: "crm_existing" });
  }
  if (args.googleOrgName?.trim() && args.googleOrgName.length > 2) {
    candidates.push({ name: args.googleOrgName.trim(), confidence: 0.9, source: "google_contact_org" });
  }
  if (args.websiteOrgName?.trim()) {
    candidates.push({ name: args.websiteOrgName.trim(), confidence: 0.88, source: "website_structured" });
  }
  if (args.websiteTitle?.trim()) {
    const cleaned = args.websiteTitle.split(/[|\-–—]/)[0]?.trim();
    if (cleaned && cleaned.length > 2) {
      candidates.push({ name: cleaned, confidence: 0.65, source: "website_title" });
    }
  }
  if (args.signatureOrg?.trim()) {
    candidates.push({ name: args.signatureOrg.trim(), confidence: 0.6, source: "email_signature" });
  }

  const domainCandidate = domainStemToCandidate(registrableDomain);
  candidates.push({ name: domainCandidate, confidence: 0.35, source: "domain_derived" });

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const normalizedName = best.name.toLowerCase().replace(LEGAL_SUFFIXES, "").trim();

  const domainStemLower = (registrableDomain.split(".")[0] ?? "").toLowerCase();
  const nameLooksLikeBlindDomain =
    best.source === "domain_derived"
    || (best.name.toLowerCase().replace(/\s/g, "") === domainStemLower);

  return {
    displayName: best.name,
    normalizedName,
    confidence: best.confidence,
    source: best.source,
    shouldSuppress: isInfrastructureHost(args.domain) || (nameLooksLikeBlindDomain && best.confidence < 0.5),
    registrableDomain,
  };
}
