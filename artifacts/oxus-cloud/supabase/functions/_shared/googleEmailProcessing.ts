/** Privacy-preserving Gmail message parsing — no full body retention. */

export type ParsedEmailMessage = {
  messageId: string;
  threadId: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  date: string | null;
  direction: "inbound" | "outbound" | "unknown";
  snippet: string | null;
  bodyExcerpt: string | null;
  signatureHints: {
    jobTitle?: string;
    phone?: string;
    company?: string;
    website?: string;
  };
};

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function extractHeader(headers: Array<{ name?: string; value?: string }>, name: string): string | null {
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() ?? null;
}

function parseEmailAddress(raw: string | null): { email: string | null; name: string | null } {
  if (!raw?.trim()) return { email: null, name: null };
  const match = raw.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
  if (!match) return { email: raw.trim().toLowerCase(), name: null };
  return { email: match[2]?.trim().toLowerCase() ?? null, name: match[1]?.trim() ?? null };
}

function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    if (/^From:\s/.test(line.trim()) && cleaned.length > 5) break;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodyExcerpt(payload: Record<string, unknown>, maxChars = 1500): string {
  const parts: string[] = [];
  const mimeType = payload.mimeType as string | undefined;
  const body = payload.body as { data?: string; size?: number } | undefined;
  if (body?.data) {
    const decoded = decodeBase64Url(body.data);
    parts.push(mimeType?.includes("html") ? stripHtml(decoded) : decoded);
  }
  const nested = payload.parts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(nested)) {
    for (const part of nested) {
      const partMime = part.mimeType as string | undefined;
      if (partMime?.startsWith("multipart/")) {
        parts.push(extractBodyExcerpt(part, maxChars));
      } else if (partMime === "text/plain" || partMime === "text/html") {
        const partBody = part.body as { data?: string } | undefined;
        if (partBody?.data) {
          const decoded = decodeBase64Url(partBody.data);
          parts.push(partMime.includes("html") ? stripHtml(decoded) : decoded);
        }
      }
    }
  }
  const combined = stripQuotedReply(parts.join("\n").trim());
  return combined.slice(0, maxChars);
}

function extractSignatureHints(excerpt: string): ParsedEmailMessage["signatureHints"] {
  const hints: ParsedEmailMessage["signatureHints"] = {};
  const titleMatch = excerpt.match(/(?:^|\n)(?:title|role|position):\s*(.+)$/im);
  if (titleMatch) hints.jobTitle = titleMatch[1].trim().slice(0, 120);
  const phoneMatch = excerpt.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  if (phoneMatch) hints.phone = phoneMatch[0].trim();
  const websiteMatch = excerpt.match(/https?:\/\/[^\s]+/i);
  if (websiteMatch) hints.website = websiteMatch[0];
  return hints;
}

export function parseGmailMessage(
  message: Record<string, unknown>,
  ownerEmail: string,
  includeContent: boolean,
): ParsedEmailMessage {
  const payload = (message.payload ?? {}) as Record<string, unknown>;
  const headers = (payload.headers ?? []) as Array<{ name?: string; value?: string }>;
  const fromRaw = extractHeader(headers, "From");
  const from = parseEmailAddress(fromRaw);
  const toRaw = extractHeader(headers, "To") ?? "";
  const ccRaw = extractHeader(headers, "Cc") ?? "";
  const toEmails = toRaw.split(",").map((s) => parseEmailAddress(s.trim()).email).filter(Boolean) as string[];
  const ccEmails = ccRaw.split(",").map((s) => parseEmailAddress(s.trim()).email).filter(Boolean) as string[];
  const subject = extractHeader(headers, "Subject");
  const date = extractHeader(headers, "Date");
  const owner = ownerEmail.toLowerCase();
  const direction = from.email === owner ? "outbound" : toEmails.includes(owner) || ccEmails.includes(owner) ? "inbound" : "unknown";
  const bodyExcerpt = includeContent ? extractBodyExcerpt(payload) : null;
  return {
    messageId: String(message.id ?? ""),
    threadId: String(message.threadId ?? ""),
    subject,
    fromEmail: from.email,
    fromName: from.name,
    toEmails,
    ccEmails,
    date,
    direction,
    snippet: typeof message.snippet === "string" ? message.snippet.slice(0, 500) : null,
    bodyExcerpt,
    signatureHints: bodyExcerpt ? extractSignatureHints(bodyExcerpt) : {},
  };
}

export function collectParticipantEmails(parsed: ParsedEmailMessage): string[] {
  return [...new Set([parsed.fromEmail, ...parsed.toEmails, ...parsed.ccEmails].filter(Boolean) as string[])];
}
