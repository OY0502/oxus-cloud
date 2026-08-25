import { parseDomainInput } from "./domain.ts";

export type SenderCategory =
  | "free_email"
  | "internal_oxus"
  | "corporate"
  | "role_inbox"
  | "automated_sender"
  | "infrastructure"
  | "email_marketing"
  | "payment_provider"
  | "development_platform"
  | "support_platform"
  | "unknown";

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
  "msn.com", "ymail.com", "fastmail.com",
]);

export const ROLE_INBOX_LOCAL_PARTS = new Set([
  "hello", "hi", "info", "support", "sales", "billing", "accounting", "accounts",
  "team", "admin", "contact", "research", "marketing", "notifications", "notification",
  "no-reply", "noreply", "donotreply", "do-not-reply", "mailer-daemon", "postmaster",
  "bounce", "help", "service", "customerservice", "customer-service", "press", "media",
  "careers", "jobs", "hr", "legal", "privacy", "security", "abuse", "feedback",
  "verify", "mail", "system", "auth", "payments", "receipts", "failed-payment",
  "failed-payments", "failedpayments",
]);

const AUTOMATED_LOCAL_PATTERNS = [
  /^no[-_.]?reply$/i,
  /^donotreply$/i,
  /^notifications?$/i,
  /^mailer-daemon$/i,
  /^postmaster$/i,
  /^bounce/i,
  /^failed[-_.]?payments?/i,
  /^payments?\+/i,
  /^verify$/i,
  /^system$/i,
  /^auth$/i,
  /\+\w+@/,
];

const INFRASTRUCTURE_DOMAIN_PATTERNS: Array<{ pattern: RegExp; category: SenderCategory }> = [
  { pattern: /\.hubspot\.com$/i, category: "infrastructure" },
  { pattern: /^bcc\./i, category: "infrastructure" },
  { pattern: /^auth\./i, category: "infrastructure" },
  { pattern: /^email\./i, category: "email_marketing" },
  { pattern: /^mail\./i, category: "email_marketing" },
  { pattern: /^track\./i, category: "infrastructure" },
  { pattern: /^tracking\./i, category: "infrastructure" },
  { pattern: /^cdn\./i, category: "infrastructure" },
  { pattern: /^static\./i, category: "infrastructure" },
  { pattern: /^oauth\./i, category: "infrastructure" },
  { pattern: /^webhooks?\./i, category: "infrastructure" },
  { pattern: /^api\./i, category: "infrastructure" },
  { pattern: /^status\./i, category: "support_platform" },
  { pattern: /^docs\./i, category: "development_platform" },
  { pattern: /retool-email/i, category: "infrastructure" },
];

export const KNOWN_PLATFORM_DOMAINS = new Set([
  "stripe.com", "github.com", "gitlab.com", "slack.com", "notion.so", "figma.com",
  "linear.app", "vercel.com", "supabase.com", "trigger.dev", "firecrawl.dev",
  "google.com", "microsoft.com", "apple.com", "amazonaws.com", "cloudflare.com",
  "sendgrid.net", "mailgun.org", "postmarkapp.com", "intercom.io", "zendesk.com",
  "hubspot.com", "salesforce.com", "atlassian.com", "clickup.com", "pandadoc.com",
  "wise.com", "paypal.com", "openrouter.ai", "langfuse.com", "bubble.io", "upwork.com",
  "retool.com",
]);

const INTERNAL_OXUS_SUFFIXES = ["@oxus.agency", "@oxus.cloud"];

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

export function emailLocalPart(email: string): string {
  const normalized = normalizeEmail(email) ?? email;
  return normalized.split("@")[0] ?? "";
}

export function isInternalOxusEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return INTERNAL_OXUS_SUFFIXES.some((s) => lower.endsWith(s));
}

export function isFreeEmailDomain(domain: string): boolean {
  const registrable = parseDomainInput(domain).registrableDomain ?? domain.toLowerCase();
  return FREE_EMAIL_DOMAINS.has(registrable);
}

export function isRoleInboxLocalPart(localPart: string): boolean {
  const base = (localPart.split("+")[0] ?? "").toLowerCase();
  if (ROLE_INBOX_LOCAL_PARTS.has(base)) return true;
  const collapsed = base.replace(/[._-]/g, "");
  if (ROLE_INBOX_LOCAL_PARTS.has(collapsed)) return true;
  return /^failed[-_.]?payments?/i.test(base);
}

export function isAutomatedSender(email: string): boolean {
  const local = emailLocalPart(email);
  if (!local) return true;
  if (/^(no[-_.]?reply|notifications?|mailer-daemon|postmaster|bounce|verify|system|auth)/i.test(local)) {
    return true;
  }
  if (/failed[-_.]?payments?/i.test(local)) return true;
  if (local.includes("+") && /acct|payment|notify|track/i.test(local)) return true;
  return AUTOMATED_LOCAL_PATTERNS.some((p) => p.test(local) || p.test(email));
}

export function isNumericIdentity(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d{5,}$/.test(trimmed)) return true;
  if (/^[0-9a-f]{20,}$/i.test(trimmed)) return true;
  const digits = (trimmed.match(/\d/g) ?? []).length;
  return trimmed.length >= 5 && digits / trimmed.length >= 0.7;
}

export function isMalformedDisplayName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed.includes("@") || trimmed.includes("+")) return true;
  if (/failed[-_. ]?payments?/i.test(trimmed)) return true;
  if (/^[a-z0-9]{12,}$/i.test(trimmed.replace(/\s/g, ""))) return true;
  if (/^(googlecloud|infoportugaltravel|masaljovana\d*)$/i.test(trimmed.replace(/\s/g, ""))) return true;
  const lower = trimmed.toLowerCase();
  if (ROLE_INBOX_LOCAL_PARTS.has(lower)) return true;
  if (trimmed.length > 60) return true;
  return false;
}

export function classifyEmailSender(email: string): {
  category: SenderCategory;
  localPart: string;
  domain: string | null;
  registrableDomain: string | null;
  isRoleInbox: boolean;
  isAutomated: boolean;
} {
  const normalized = normalizeEmail(email) ?? email;
  const localPart = emailLocalPart(normalized);
  const domain = normalized.split("@")[1] ?? null;
  const registrableDomain = domain ? parseDomainInput(domain).registrableDomain : null;
  const automated = isAutomatedSender(normalized);
  const roleInbox = isRoleInboxLocalPart(localPart);

  if (isInternalOxusEmail(normalized)) {
    return { category: "internal_oxus", localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: false };
  }
  if (automated) {
    return { category: "automated_sender", localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: true };
  }
  if (registrableDomain && isFreeEmailDomain(registrableDomain)) {
    return { category: "free_email", localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: false };
  }
  if (roleInbox) {
    return { category: "role_inbox", localPart, domain, registrableDomain, isRoleInbox: true, isAutomated: false };
  }

  if (domain) {
    for (const { pattern, category } of INFRASTRUCTURE_DOMAIN_PATTERNS) {
      if (pattern.test(domain)) {
        return { category, localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: false };
      }
    }
    if (registrableDomain && KNOWN_PLATFORM_DOMAINS.has(registrableDomain)) {
      return { category: "development_platform", localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: false };
    }
    if (registrableDomain?.includes("stripe")) {
      return { category: "payment_provider", localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: automated };
    }
  }

  if (registrableDomain) {
    return { category: "corporate", localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: false };
  }
  return { category: "unknown", localPart, domain, registrableDomain, isRoleInbox: false, isAutomated: false };
}

export function isInfrastructureHost(domain: string): boolean {
  const parsed = parseDomainInput(domain);
  if (!parsed.registrableDomain) return false;
  const host = parsed.normalizedHost;
  for (const { pattern } of INFRASTRUCTURE_DOMAIN_PATTERNS) {
    if (pattern.test(host)) return true;
  }
  if (parsed.subdomain && parsed.subdomain.split(".").some((s) =>
    ["bcc", "auth", "track", "tracking", "cdn", "mail", "email", "oauth", "webhook", "api"].includes(s),
  )) {
    return true;
  }
  return false;
}

export function shouldCreateCompanyFromDomain(domain: string): boolean {
  const parsed = parseDomainInput(domain);
  if (!parsed.registrableDomain || isFreeEmailDomain(parsed.registrableDomain)) return false;
  if (isInfrastructureHost(domain)) return false;
  return true;
}

export function resolvePlatformCompany(domain: string): string | null {
  const registrable = parseDomainInput(domain).registrableDomain;
  if (!registrable) return null;
  if (KNOWN_PLATFORM_DOMAINS.has(registrable)) {
    const stem = registrable.split(".")[0] ?? registrable;
    if (stem === "bubble") return "Bubble";
    if (stem === "upwork") return "Upwork";
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  }
  if (registrable.endsWith(".hubspot.com") || registrable.includes("hubspot")) return "HubSpot";
  if (registrable.includes("firecrawl")) return "Firecrawl";
  if (registrable.includes("retool")) return "Retool";
  return null;
}
