/** Deterministic request/resolution signal detection from ClickUp comment text. */

import { isEscalationComment } from "./pmActionDedupe.ts";

export type ResolutionConfidence = "high" | "medium" | "low";

export type ResolutionSignal = {
  kind: "resolved";
  confidence: ResolutionConfidence;
  reason: string;
};

export type RequestSignal = {
  kind: "request" | "blocker";
  confidence: ResolutionConfidence;
  reason: string;
  topic_keywords: string[];
};

const RESOLUTION_PATTERNS: Array<{ pattern: RegExp; confidence: ResolutionConfidence; reason: string }> = [
  { pattern: /\bplease\s+disregard\b/i, confidence: "high", reason: "Comment asks to disregard the earlier request." },
  { pattern: /\bdisregard\b/i, confidence: "high", reason: "Comment says to disregard the earlier request." },
  { pattern: /\bnever\s+mind\b/i, confidence: "high", reason: "Comment says never mind." },
  { pattern: /\bignore\s+this\b/i, confidence: "high", reason: "Comment says to ignore the earlier request." },
  { pattern: /\bi\s+received\s+(?:a\s+)?file\b/i, confidence: "high", reason: "Developer says they received the needed file." },
  { pattern: /\breceived\s+(?:a\s+)?file\b/i, confidence: "high", reason: "Comment indicates the file was received." },
  { pattern: /\bi\s+received\s+it\b/i, confidence: "high", reason: "Developer says they received what was needed." },
  { pattern: /\breceived\s+it\b/i, confidence: "high", reason: "Comment indicates the item was received." },
  { pattern: /\bgot\s+it\b/i, confidence: "high", reason: "Developer confirms they got what was needed." },
  { pattern: /\bthanks?,?\s+got\s+it\b/i, confidence: "high", reason: "Developer thanks and confirms receipt." },
  { pattern: /\bfound\s+it\b/i, confidence: "medium", reason: "Developer found what was needed." },
  { pattern: /\ball\s+good\b/i, confidence: "medium", reason: "Developer says all good." },
  { pattern: /\bworks\s+now\b/i, confidence: "high", reason: "Developer says it works now." },
  { pattern: /\baccess\s+works\s+now\b/i, confidence: "high", reason: "Developer says access works now." },
  { pattern: /\bi\s+have\s+access\s+now\b/i, confidence: "high", reason: "Developer says they have access now." },
  { pattern: /\bresolved\b/i, confidence: "medium", reason: "Comment says the issue is resolved." },
  { pattern: /\bfixed\b/i, confidence: "medium", reason: "Comment says the issue is fixed." },
  { pattern: /\bno\s+longer\s+needed\b/i, confidence: "high", reason: "Comment says it is no longer needed." },
  { pattern: /\bnot\s+needed\s+anymore\b/i, confidence: "high", reason: "Comment says it is not needed anymore." },
  { pattern: /\bthis\s+is\s+handled\b/i, confidence: "high", reason: "Comment says the issue is handled." },
  { pattern: /\bhandled\b/i, confidence: "low", reason: "Comment suggests the issue is handled." },
];

const REQUEST_PATTERNS: Array<{ pattern: RegExp; kind: "request" | "blocker"; confidence: ResolutionConfidence; reason: string }> = [
  { pattern: /\bdo\s+we\s+have\b/i, kind: "request", confidence: "high", reason: "Question asking whether a resource exists." },
  { pattern: /\bcan\s+(?:we|you)\s+(?:get|provide|share)\b/i, kind: "request", confidence: "high", reason: "Request to provide a resource." },
  { pattern: /\bneed(?:s|ed)?\s+(?:a\s+)?(?:file|csv|sample|access|credentials)\b/i, kind: "request", confidence: "high", reason: "Request for a file or access." },
  { pattern: /\bwaiting\s+for\b/i, kind: "blocker", confidence: "high", reason: "Waiting for something to proceed." },
  { pattern: /\bcannot\s+proceed\b/i, kind: "blocker", confidence: "high", reason: "Work cannot proceed." },
  { pattern: /\bcan'?t\s+proceed\b/i, kind: "blocker", confidence: "high", reason: "Work cannot proceed." },
  { pattern: /\bblocked\b/i, kind: "blocker", confidence: "medium", reason: "Developer reports being blocked." },
  { pattern: /\bmissing\b/i, kind: "blocker", confidence: "medium", reason: "Something is missing." },
  { pattern: /\bno\s+access\b/i, kind: "blocker", confidence: "high", reason: "Missing access reported." },
  { pattern: /\bdon'?t\s+have\s+access\b/i, kind: "blocker", confidence: "high", reason: "Missing access reported." },
  { pattern: /\bneed\s+access\b/i, kind: "blocker", confidence: "high", reason: "Access is needed." },
];

export const TOPIC_KEYWORDS = [
  "csv",
  "sample",
  "file",
  "upload",
  "bulk",
  "access",
  "bubble",
  "credentials",
  "figma",
  "slack",
  "clickup",
  "invite",
  "permission",
  "login",
  "staging",
  "production",
] as const;

export function normalizeCommentText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function extractTopicKeywords(text: string): string[] {
  const lower = normalizeCommentText(text).toLowerCase();
  const found = TOPIC_KEYWORDS.filter((keyword) => lower.includes(keyword));
  return [...new Set(found)];
}

export function detectResolutionSignal(text: string): ResolutionSignal | null {
  const normalized = normalizeCommentText(text);
  if (!normalized) return null;
  if (isEscalationComment(normalized)) return null;

  for (const entry of RESOLUTION_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return { kind: "resolved", confidence: entry.confidence, reason: entry.reason };
    }
  }
  return null;
}

export function detectRequestSignal(text: string): RequestSignal | null {
  const normalized = normalizeCommentText(text);
  if (!normalized) return null;

  for (const entry of REQUEST_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return {
        kind: entry.kind,
        confidence: entry.confidence,
        reason: entry.reason,
        topic_keywords: extractTopicKeywords(normalized),
      };
    }
  }

  if (/\?/.test(normalized) && extractTopicKeywords(normalized).length > 0) {
    return {
      kind: "request",
      confidence: "medium",
      reason: "Question about a specific resource or file.",
      topic_keywords: extractTopicKeywords(normalized),
    };
  }

  return null;
}

export function topicKeywordsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setB = new Set(b);
  return a.some((keyword) => setB.has(keyword));
}

export function topicKeywordsFromAction(item: {
  title?: string | null;
  description?: string | null;
  blocker_resource?: string | null;
  action_payload?: Record<string, unknown> | null;
  last_signal_summary?: string | null;
}): string[] {
  const blob = [
    item.title,
    item.description,
    item.blocker_resource,
    item.last_signal_summary,
    typeof item.action_payload?.system_name === "string" ? item.action_payload.system_name : null,
    typeof item.action_payload?.comment_text === "string" ? item.action_payload.comment_text : null,
    typeof item.action_payload?.question_text === "string" ? item.action_payload.question_text : null,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  return extractTopicKeywords(blob);
}
