import {
  isAutomatedSender,
  isFreeEmailDomain,
  isInternalOxusEmail,
  normalizeEmail,
  extractDomainFromEmail,
} from "./google-auth.ts";

const NOISE_SENDER_PATTERNS = [
  "noreply", "no-reply", "donotreply", "mailer-daemon", "notifications@",
  "newsletter", "billing@", "receipts@", "alerts@", "support+",
];

const NOISE_SUBJECT_PATTERNS = [
  "unsubscribe", "newsletter", "security alert", "password reset", "verify your",
  "receipt", "invoice paid", "payment received", "your order", "shipment",
  "github", "vercel", "stripe", "google alert", "monitoring", "deployment",
  "account verification", "sign in", "login attempt", "product update",
];

const COMMERCIAL_SIGNALS = [
  "proposal", "scope", "quote", "budget", "contract", "meeting", "delivery",
  "invoice", "implementation", "project", "sow", "milestone", "kickoff",
];

export type ThreadFilterInput = {
  subject: string | null;
  snippet: string | null;
  participants: string[];
  labels: string[];
  ownerEmail: string;
  headers?: Array<{ name?: string; value?: string }>;
  lastMessageAt?: string | null;
  lookbackMonths?: number;
};

export type ThreadFilterResult = {
  coreRelevant: boolean;
  enrichmentEligible: boolean;
  priorityScore: number;
  reason: string;
  primaryExternalEmail: string | null;
  twoWayConversation: boolean;
};

function headerValue(headers: Array<{ name?: string; value?: string }>, name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function hasBulkEmailHeaders(headers: Array<{ name?: string; value?: string }>): boolean {
  if (headerValue(headers, "List-Unsubscribe") || headerValue(headers, "List-Id")) return true;
  const precedence = headerValue(headers, "Precedence").toLowerCase();
  if (precedence === "bulk" || precedence === "list") return true;
  const auto = headerValue(headers, "Auto-Submitted").toLowerCase();
  if (auto && auto !== "no") return true;
  return false;
}

function isNoiseSender(email: string): boolean {
  const lower = email.toLowerCase();
  return NOISE_SENDER_PATTERNS.some((p) => lower.includes(p));
}

function isInfrastructureDomain(domain: string): boolean {
  const infra = [
    "google.com", "github.com", "vercel.com", "stripe.com", "slack.com",
    "clickup.com", "notion.so", "linkedin.com", "facebookmail.com",
  ];
  return infra.includes(domain.toLowerCase());
}

export function scoreGmailThread(input: ThreadFilterInput): ThreadFilterResult {
  const external = input.participants
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => !!e && !isInternalOxusEmail(e) && !isAutomatedSender(e) && !isNoiseSender(e));

  if (external.length === 0) {
    return {
      coreRelevant: false,
      enrichmentEligible: false,
      priorityScore: 0,
      reason: "internal_only",
      primaryExternalEmail: null,
      twoWayConversation: false,
    };
  }

  if (input.labels.includes("SPAM") || input.labels.includes("TRASH")) {
    return {
      coreRelevant: false,
      enrichmentEligible: false,
      priorityScore: 0,
      reason: "spam_trash",
      primaryExternalEmail: external[0] ?? null,
      twoWayConversation: false,
    };
  }

  const headers = input.headers ?? [];
  if (hasBulkEmailHeaders(headers)) {
    return {
      coreRelevant: true,
      enrichmentEligible: false,
      priorityScore: 5,
      reason: "bulk_headers_metadata_only",
      primaryExternalEmail: external[0] ?? null,
      twoWayConversation: false,
    };
  }

  const hay = `${input.subject ?? ""} ${input.snippet ?? ""}`.toLowerCase();
  const owner = normalizeEmail(input.ownerEmail) ?? input.ownerEmail.toLowerCase();
  const hasReply = input.labels.includes("SENT") || input.participants.some((e) => normalizeEmail(e) === owner);
  const twoWay = hasReply && external.length >= 1;

  const noiseHit = NOISE_SUBJECT_PATTERNS.some((n) => hay.includes(n));
  const commercialHit = COMMERCIAL_SIGNALS.some((s) => hay.includes(s));
  const primaryEmail = external[0] ?? null;
  const domain = primaryEmail ? extractDomainFromEmail(primaryEmail) : null;

  if (noiseHit && !twoWay && !commercialHit) {
    return {
      coreRelevant: true,
      enrichmentEligible: false,
      priorityScore: 10,
      reason: "automated_noise_metadata_only",
      primaryExternalEmail: primaryEmail,
      twoWayConversation: false,
    };
  }

  if (domain && isInfrastructureDomain(domain) && !twoWay && !commercialHit) {
    return {
      coreRelevant: true,
      enrichmentEligible: false,
      priorityScore: 15,
      reason: "infrastructure_sender",
      primaryExternalEmail: primaryEmail,
      twoWayConversation: twoWay,
    };
  }

  let priority = 40;
  if (twoWay) priority += 30;
  if (commercialHit) priority += 25;
  if (external.length >= 2) priority += 10;
  if (domain && !isFreeEmailDomain(domain)) priority += 15;

  const lookbackMonths = input.lookbackMonths ?? 12;
  if (input.lastMessageAt) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - lookbackMonths);
    if (new Date(input.lastMessageAt) < cutoff) {
      priority -= 20;
      if (!twoWay && !commercialHit) {
        return {
          coreRelevant: true,
          enrichmentEligible: false,
          priorityScore: Math.max(priority, 20),
          reason: "historical_metadata_only",
          primaryExternalEmail: primaryEmail,
          twoWayConversation: twoWay,
        };
      }
    }
  }

  return {
    coreRelevant: true,
    enrichmentEligible: priority >= 55,
    priorityScore: priority,
    reason: twoWay ? "external_conversation" : "external_participant",
    primaryExternalEmail: primaryEmail,
    twoWayConversation: twoWay,
  };
}

export function threadLooksRelevant(input: ThreadFilterInput): { relevant: boolean; reason: string } {
  const scored = scoreGmailThread(input);
  return { relevant: scored.coreRelevant, reason: scored.reason };
}
