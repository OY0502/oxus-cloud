import { classifyEmailSender, isNumericIdentity } from "./senderClassification";

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
  shouldSuppress: boolean;
};

function splitName(displayName: string): { firstName: string | null; lastName: string | null } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function isPlausibleHumanName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("@")) return false;
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
  const segments = local.split(/[._-]+/).filter(Boolean);
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
}): ResolvedPersonName {
  const sender = classifyEmailSender(args.email);

  if (args.manuallyConfirmed && args.confirmedName?.trim()) {
    const displayName = args.confirmedName.trim();
    const { firstName, lastName } = splitName(displayName);
    return {
      displayName,
      firstName,
      lastName,
      confidence: 1,
      source: "manual",
      isRoleInbox: false,
      roleInboxLabel: null,
      shouldSuppress: false,
    };
  }

  if (sender.isRoleInbox || sender.category === "automated_sender") {
    return {
      displayName: sender.isRoleInbox ? "General inbox" : "Automated sender",
      firstName: null,
      lastName: null,
      confidence: sender.isRoleInbox ? 0.7 : 0.4,
      source: "role_inbox",
      isRoleInbox: sender.isRoleInbox,
      roleInboxLabel: sender.isRoleInbox ? `${sender.localPart}@${sender.registrableDomain ?? sender.domain}` : null,
      shouldSuppress: sender.category === "automated_sender",
    };
  }

  const candidates: Array<{ name: string; confidence: number; source: PersonNameSource }> = [];

  if (args.googleStructuredName?.trim() && isPlausibleHumanName(args.googleStructuredName)) {
    candidates.push({ name: args.googleStructuredName.trim(), confidence: 0.95, source: "google_contact" });
  }
  if (args.displayName?.trim() && isPlausibleHumanName(args.displayName) && !args.displayName.includes("@")) {
    candidates.push({ name: args.displayName.trim(), confidence: 0.9, source: "gmail_display" });
  }
  if (args.calendarDisplayName?.trim() && isPlausibleHumanName(args.calendarDisplayName) && !args.calendarDisplayName.includes("@")) {
    candidates.push({ name: args.calendarDisplayName.trim(), confidence: 0.85, source: "calendar_attendee" });
  }
  if (args.signatureName?.trim() && isPlausibleHumanName(args.signatureName)) {
    candidates.push({ name: args.signatureName.trim(), confidence: 0.8, source: "email_signature" });
  }

  const localParsed = parseEmailLocalPart(args.email);
  if (localParsed) {
    candidates.push({ name: localParsed, confidence: 0.45, source: "email_local_part" });
  }

  if (candidates.length === 0 || isNumericIdentity(args.displayName ?? "")) {
    return {
      displayName: "Unknown contact",
      firstName: null,
      lastName: null,
      confidence: 0.2,
      source: "unknown",
      isRoleInbox: false,
      roleInboxLabel: null,
      shouldSuppress: sender.category === "infrastructure" || isNumericIdentity(args.displayName ?? ""),
    };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const { firstName, lastName } = splitName(best.name);
  return {
    displayName: best.name,
    firstName,
    lastName,
    confidence: best.confidence,
    source: best.source,
    isRoleInbox: false,
    roleInboxLabel: null,
    shouldSuppress: best.confidence < 0.35,
  };
}
