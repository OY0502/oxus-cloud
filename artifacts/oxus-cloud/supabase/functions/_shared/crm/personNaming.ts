import { classifyEmailSender, isMalformedDisplayName, isNumericIdentity } from "./senderClassification.ts";

export type PersonNameSource =
  | "manual"
  | "google_contact"
  | "gmail_display"
  | "calendar_attendee"
  | "email_signature"
  | "crm_existing"
  | "email_local_part"
  | "role_inbox"
  | "unknown";

export type ResolvedPersonName = {
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  confidence: number;
  source: PersonNameSource;
  isRoleInbox: boolean;
  roleInboxLabel: string | null;
  isAutomatedSender: boolean;
  shouldSuppress: boolean;
  qualityReason: string | null;
};

function splitName(displayName: string): { firstName: string | null; lastName: string | null } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function isPlausibleHumanName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("@") || isMalformedDisplayName(trimmed)) return false;
  if (isNumericIdentity(trimmed)) return false;
  if (/^[a-z0-9._-]+$/i.test(trimmed) && !trimmed.includes(" ")) {
    const lower = trimmed.toLowerCase();
    if (lower.length < 3 || /^\d/.test(lower)) return false;
  }
  return trimmed.length >= 2;
}

function parseEmailLocalPart(email: string): string | null {
  const local = email.split("@")[0] ?? "";
  if (!local || isNumericIdentity(local)) return null;
  const segments = local.split(/[._+-]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(isNumericIdentity)) return null;
  const candidate = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(" ");
  return isPlausibleHumanName(candidate) ? candidate : null;
}

export function resolvePersonName(args: {
  email: string;
  displayName?: string | null;
  manuallyConfirmed?: boolean;
  confirmedName?: string | null;
  googleStructuredName?: string | null;
  calendarDisplayName?: string | null;
  signatureName?: string | null;
  crmExistingName?: string | null;
}): ResolvedPersonName {
  const sender = classifyEmailSender(args.email);

  if (args.manuallyConfirmed && args.confirmedName?.trim()) {
    const displayName = args.confirmedName.trim();
    const { firstName, lastName } = splitName(displayName);
    return {
      displayName, firstName, lastName, confidence: 1, source: "manual",
      isRoleInbox: false, roleInboxLabel: null, isAutomatedSender: false,
      shouldSuppress: false, qualityReason: null,
    };
  }

  if (sender.isAutomated || sender.category === "payment_provider" || sender.category === "infrastructure") {
    return {
      displayName: "Automated sender",
      firstName: null, lastName: null, confidence: 0.15, source: "unknown",
      isRoleInbox: false, roleInboxLabel: null, isAutomatedSender: true,
      shouldSuppress: true,
      qualityReason: "Automated or transactional email sender",
    };
  }

  if (sender.isRoleInbox) {
    return {
      displayName: "General inbox",
      firstName: null, lastName: null, confidence: 0.7, source: "role_inbox",
      isRoleInbox: true,
      roleInboxLabel: `${sender.localPart}@${sender.registrableDomain ?? sender.domain ?? "unknown"}`,
      isAutomatedSender: false,
      shouldSuppress: false,
      qualityReason: "Role inbox address — not a personal contact",
    };
  }

  const candidates: Array<{ name: string; confidence: number; source: PersonNameSource }> = [];

  if (args.crmExistingName?.trim() && isPlausibleHumanName(args.crmExistingName)) {
    candidates.push({ name: args.crmExistingName.trim(), confidence: 0.98, source: "crm_existing" });
  }
  if (args.googleStructuredName?.trim() && isPlausibleHumanName(args.googleStructuredName)) {
    candidates.push({ name: args.googleStructuredName.trim(), confidence: 0.95, source: "google_contact" });
  }
  if (args.displayName?.trim() && isPlausibleHumanName(args.displayName) && !args.displayName.includes("@")) {
    candidates.push({ name: args.displayName.trim(), confidence: 0.9, source: "gmail_display" });
  }
  if (args.calendarDisplayName?.trim() && isPlausibleHumanName(args.calendarDisplayName)) {
    candidates.push({ name: args.calendarDisplayName.trim(), confidence: 0.85, source: "calendar_attendee" });
  }
  if (args.signatureName?.trim() && isPlausibleHumanName(args.signatureName)) {
    candidates.push({ name: args.signatureName.trim(), confidence: 0.8, source: "email_signature" });
  }

  const localParsed = parseEmailLocalPart(args.email);
  if (localParsed) {
    candidates.push({ name: localParsed, confidence: 0.45, source: "email_local_part" });
  }

  if (candidates.length === 0 || isNumericIdentity(args.displayName ?? "") || isMalformedDisplayName(args.displayName ?? "")) {
    return {
      displayName: "Unknown contact",
      firstName: null, lastName: null, confidence: 0.2, source: "unknown",
      isRoleInbox: false, roleInboxLabel: null, isAutomatedSender: false,
      shouldSuppress: true,
      qualityReason: isNumericIdentity(args.displayName ?? "")
        ? "Numeric or tracking-style identity"
        : "No reliable human name evidence",
    };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const { firstName, lastName } = splitName(best.name);
  const lowConfidence = best.confidence < 0.55;

  return {
    displayName: best.name,
    firstName, lastName,
    confidence: best.confidence,
    source: best.source,
    isRoleInbox: false,
    roleInboxLabel: null,
    isAutomatedSender: false,
    shouldSuppress: best.confidence < 0.35,
    qualityReason: lowConfidence ? "Name derived only from weak email evidence" : null,
  };
}
