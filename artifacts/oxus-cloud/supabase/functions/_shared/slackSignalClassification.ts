import { detectResolutionSignal, detectRequestSignal } from "./resolutionDetection.ts";

export type SlackSignalType =
  | "blocker"
  | "access_needed"
  | "client_question"
  | "decision"
  | "scope_change"
  | "progress_update"
  | "meeting_needed"
  | "general_action"
  | "resolved"
  | "noise";

export type SlackSignalPriority = "low" | "medium" | "high" | "urgent";

export type SlackSignalClassification = {
  signal_type: SlackSignalType;
  signal_confidence: number;
  title: string;
  summary: string;
  action_key: string | null;
  action_family: string | null;
  priority: SlackSignalPriority;
  suggested_action_type?: "create_clickup_task" | "manual" | "ask_client_question";
};

const NOISE_PATTERNS: RegExp[] = [
  /^(?:thanks?|thank you|thx|ty|ok|okay|k|cool|nice|great|awesome|👍|🙏)\.?$/i,
  /^(?:hi|hello|hey)[!.?\s]*$/i,
  /^(?:lol|haha)\.?$/i,
];

const MEETING_PATTERNS: RegExp[] = [
  /\b(?:have|need)\s+to\s+schedule\b/i,
  /\bschedule\s+(?:a\s+)?(?:meeting|call)\b/i,
  /\bneed\s+to\s+schedule\b/i,
  /\blet'?s\s+(?:book|schedule)\s+(?:a\s+)?(?:meeting|call)\b/i,
  /\bcan\s+we\s+(?:schedule|arrange|book)\s+(?:a\s+)?(?:meeting|call)\b/i,
  /\barrange\s+(?:a\s+)?(?:client\s+)?(?:call|meeting)\b/i,
  /\bbook\s+(?:a\s+)?(?:meeting|call)\b/i,
  /\bclient\s+meeting\b/i,
  /\bclient\s+wants\s+(?:a\s+)?(?:call|meeting)\b/i,
  /\bmeeting\s+with\s+(?:the\s+)?client\b/i,
  /\bcall\s+with\s+(?:the\s+)?client\b/i,
  /\bdemo\s+on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+\w+)/i,
];

const DECISION_PATTERNS: RegExp[] = [
  /\blet'?s\s+(?:go\s+with|do|use|pick)\b/i,
  /\bwe(?:'ll|\s+will)\s+(?:go\s+with|use|do)\b/i,
  /\bdecided\s+to\b/i,
  /\boption\s+[a-z]\b/i,
  /\bapproved\b/i,
  /\bsign(?:ed|ing)\s+off\b/i,
];

const SCOPE_PATTERNS: RegExp[] = [
  /\bout\s+of\s+scope\b/i,
  /\bscope\s+(?:change|creep|addition)\b/i,
  /\bnot\s+in\s+scope\b/i,
  /\badditional\s+(?:work|feature|request)\b/i,
  /\bchange\s+request\b/i,
];

const PROGRESS_PATTERNS: RegExp[] = [
  /\b(?:done|completed|finished|shipped|deployed|merged|live)\b/i,
  /\bmade\s+progress\b/i,
  /\bready\s+for\s+review\b/i,
  /\bupdated\b/i,
];

const CLIENT_QUESTION_PATTERNS: RegExp[] = [
  /\?\s*$/,
  /\bcan\s+(?:you|we|someone)\b/i,
  /\bcould\s+(?:you|we|someone)\b/i,
  /\bwhen\s+(?:will|can|do)\b/i,
  /\bwhat\s+(?:is|are|should)\b/i,
  /\bdo\s+we\s+have\b/i,
  /\bcan\s+(?:you|we)\s+(?:get|provide|share|send)\b/i,
];

const BLOCKER_PATTERNS: RegExp[] = [
  /\bblocked\b/i,
  /\bwaiting\s+for\b/i,
  /\bcannot\s+proceed\b/i,
  /\bcan'?t\s+proceed\b/i,
  /\bstuck\b/i,
  /\bmissing\b/i,
];

const ACCESS_PATTERNS: RegExp[] = [
  /\bno\s+access\b/i,
  /\bdon'?t\s+have\s+access\b/i,
  /\bneed\s+access\b/i,
  /\bnot\s+invited\b/i,
  /\bpermission\s+denied\b/i,
];

const WORK_REQUEST_PATTERNS: RegExp[] = [
  /\bupdate\s+(?:the\s+)?logo\b/i,
  /\bchange\s+(?:the\s+)?logo\b/i,
  /\breplace\s+(?:the\s+)?logo\b/i,
  /\buse\s+this\s+logo\b/i,
  /\bupdate\s+(?:the\s+)?header\b/i,
  /\bchange\s+(?:the\s+)?header\b/i,
  /\bonly\s+in\s+the\s+header\b/i,
  /\buse\s+this\s+image\b/i,
  /\bwith\s+this\s+one\b/i,
  /\b(?:client|they|he|she)\s+(?:also\s+)?asked\s+to\s+update\b/i,
  /\basked\s+to\s+update\b/i,
  /\bneed\s+to\s+update\b/i,
  /\bplease\s+update\b/i,
  /\bcan\s+(?:you|we)\s+update\b/i,
  /\bshould\s+update\b/i,
  /\bupdate\s+(?:the\s+)?(?:design|asset|image|icon|banner|favicon)\b/i,
  /\b(?:can|could)\s+someone\s+add\b/i,
  /\b(?:please|can you|could you)\s+(?:add|implement|fix|update|change|replace)\b/i,
  /\badd\s+(?:a\s+)?(?:mixpanel|snippet|tracking|script|pixel)\b/i,
  /\badd\s+.+\s+to\s+(?:the\s+)?(?:app\s+)?header\b/i,
  /\b(?:please\s+)?implement\b/i,
  /\b(?:please\s+)?fix\b/i,
  /\b(?:please\s+)?change\b/i,
  /\b(?:please\s+)?replace\b/i,
  /\badd\b.+\bheader\b/i,
  /\b(?:send|prepare|write)\s+(?:a\s+)?(?:weekly|project)\s+update\b/i,
  /\bweekly\s+update\b/i,
  /\bcould\s+you\s+send\b/i,
  /\bcan\s+you\s+send\b/i,
  /\b(?:please\s+)?send\s+.+\s+update\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function confidenceFromMatch(kind: "high" | "medium" | "low"): number {
  if (kind === "high") return 0.9;
  if (kind === "medium") return 0.75;
  return 0.6;
}

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractSuggestedDateText(text: string): string | null {
  const match = text.match(DAY_PATTERN);
  return match ? match[1] : null;
}

function buildMeetingTitle(text: string): string {
  const day = extractSuggestedDateText(text);
  const dayLabel = day ? capitalizeWord(day.replace(/\s+/g, " ")) : null;
  if (/client/i.test(text)) {
    return dayLabel ? `Schedule client meeting on ${dayLabel}` : "Schedule client meeting";
  }
  return dayLabel ? `Schedule meeting on ${dayLabel}` : "Schedule meeting";
}

function buildMeetingActionKey(_text: string): string | null {
  // Thread-stable identity is computed in pmActionIdentity — do not key by date
  return null;
}

function inferWorkRequestClassification(
  text: string,
  ctx?: { actor_name?: string | null; actor_classification?: string | null },
): SlackSignalClassification | null {
  if (!matchesAny(text, WORK_REQUEST_PATTERNS)) return null;

  const lower = text.toLowerCase();
  let actionFamily = "work_request";
  let title = "Review Slack work request";
  const actorName = ctx?.actor_name?.trim() || null;
  const notUrgent = /\bnot\s+urgent\b/i.test(text);
  const thisWeek = /\bthis\s+week\b/i.test(text);
  let priority: SlackSignalPriority = notUrgent ? "medium" : "medium";

  if (/\b(?:send|prepare|write)\s+(?:a\s+)?(?:weekly|project)\s+update\b/i.test(lower) || /\bweekly\s+update\b/i.test(lower)) {
    actionFamily = "weekly_update";
    const recipient = text.match(/\bto\s+([A-Z][a-zA-Z'-]+)\b/)?.[1];
    title = recipient ? `Send weekly project update to ${recipient}` : "Send weekly project update";
  } else if (/\bmixpanel\b/i.test(lower) && /\bheader\b/i.test(lower)) {
    actionFamily = "mixpanel_header_snippet";
    title = "Add Mixpanel snippet to app header";
  } else if (/\blogo\b/i.test(lower) && /\b(?:header|only in the header)\b/i.test(lower)) {
    actionFamily = "header_logo_update";
    title = "Update header logo";
  } else if (/\blogo\b/i.test(lower)) {
    actionFamily = "logo_update";
    title = "Update logo";
  } else if (/\bheader\b/i.test(lower)) {
    actionFamily = "header_update";
    title = "Update header";
  } else if (/\bsnippet\b/i.test(lower)) {
    actionFamily = "snippet_install";
    title = "Add snippet to app";
  }

  const hasAttachmentHint = /\b(?:this one|this image|attached|attachment|see (?:below|above))\b/i.test(lower);
  let summary = `Slack message indicates a work request: ${text.slice(0, 180)}`;
  if (actionFamily === "header_logo_update") {
    summary = actorName
      ? `Slack message says ${actorName} asked to update the logo, only in the header.`
      : "Slack message says someone asked to update the logo, only in the header.";
    if (hasAttachmentHint) {
      summary += " The message may include an attachment with the requested logo asset.";
    }
  } else if (actionFamily === "mixpanel_header_snippet") {
    summary = actorName
      ? `Slack message from ${actorName} asks to add a Mixpanel snippet to the app header.`
      : "Slack message asks to add a Mixpanel snippet to the app header.";
    if (thisWeek) summary += " Requested timing: this week.";
    if (notUrgent) summary += " Not urgent.";
    if (notUrgent && priority === "medium") priority = "medium";
  }

  return {
    signal_type: "general_action",
    signal_confidence: 0.85,
    title,
    summary,
    action_key: null,
    action_family: actionFamily,
    priority,
    suggested_action_type: "create_clickup_task",
  };
}

const DAY_PATTERN =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|week))\b/i;

function buildMeetingSummary(text: string): string {
  const day = extractSuggestedDateText(text);
  if (day && /client/i.test(text)) {
    return `A Slack message says a client meeting needs to be scheduled with the client on ${capitalizeWord(day.replace(/\s+/g, " "))}.`;
  }
  if (day) {
    return `A Slack message says a meeting needs to be scheduled on ${capitalizeWord(day.replace(/\s+/g, " "))}.`;
  }
  if (/client/i.test(text)) {
    return "A Slack message indicates a client meeting or call needs to be scheduled.";
  }
  return "A Slack message indicates a meeting or call needs to be scheduled.";
}

function defaultTitleForType(signalType: SlackSignalType, text: string): string {
  const preview = text.slice(0, 80);
  switch (signalType) {
    case "blocker":
      return "Resolve project blocker";
    case "access_needed":
      return "Grant access requested in Slack";
    case "client_question":
      return "Answer client question from Slack";
    case "decision":
      return "Record decision from Slack";
    case "scope_change":
      return "Review scope change from Slack";
    case "progress_update":
      return "Review progress update from Slack";
    case "resolved":
      return "Thread marked resolved in Slack";
    default:
      return preview.length > 10 ? preview : "Review Slack message";
  }
}

export type SlackClassificationContext = {
  actor_name?: string | null;
  actor_classification?: "internal" | "client" | "external" | "unknown" | null;
  link_type?: string | null;
  is_client_facing?: boolean;
};

export function classifySlackMessageWithContext(
  text: string | null | undefined,
  ctx?: SlackClassificationContext,
): SlackSignalClassification {
  const base = classifySlackMessageText(text, ctx);

  if (
    base.signal_type === "client_question" &&
    (ctx?.actor_classification === "internal" || isInternalImplementationRequest(text ?? ""))
  ) {
    const work = inferWorkRequestClassification((text ?? "").replace(/\s+/g, " ").trim(), ctx);
    if (work) return work;
    return {
      ...base,
      signal_type: "general_action",
      action_family: "work_request",
      title: base.title.replace(/^Answer client question from Slack$/i, "Review Slack request"),
      suggested_action_type: "create_clickup_task",
    };
  }

  if (base.signal_type === "general_action" && !base.suggested_action_type) {
    return { ...base, suggested_action_type: "create_clickup_task" };
  }

  return base;
}

function isInternalImplementationRequest(text: string): boolean {
  return matchesAny(text, WORK_REQUEST_PATTERNS);
}

export function classifySlackMessageText(
  text: string | null | undefined,
  ctx?: SlackClassificationContext,
): SlackSignalClassification {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 2) {
    return {
      signal_type: "noise",
      signal_confidence: 0.95,
      title: "Empty message",
      summary: "No meaningful content.",
      action_key: null,
      action_family: null,
      priority: "low",
    };
  }

  if (matchesAny(normalized, NOISE_PATTERNS)) {
    return {
      signal_type: "noise",
      signal_confidence: 0.9,
      title: "Casual message",
      summary: normalized.slice(0, 120),
      action_key: null,
      action_family: null,
      priority: "low",
    };
  }

  const resolution = detectResolutionSignal(normalized);
  if (resolution) {
    return {
      signal_type: "resolved",
      signal_confidence: confidenceFromMatch(resolution.confidence),
      title: "Issue resolved in Slack",
      summary: resolution.reason,
      action_key: null,
      action_family: null,
      priority: "low",
    };
  }

  const workRequest = inferWorkRequestClassification(normalized, ctx);
  if (workRequest) return workRequest;

  if (matchesAny(normalized, MEETING_PATTERNS)) {
    return {
      signal_type: "meeting_needed",
      signal_confidence: 0.85,
      title: buildMeetingTitle(normalized),
      summary: buildMeetingSummary(normalized),
      action_key: buildMeetingActionKey(normalized),
      action_family: "client_meeting",
      priority: "medium",
    };
  }

  if (matchesAny(normalized, ACCESS_PATTERNS)) {
    return {
      signal_type: "access_needed",
      signal_confidence: 0.88,
      title: "Grant access requested in Slack",
      summary: normalized.slice(0, 200),
      action_key: null,
      action_family: "access_request",
      priority: "high",
    };
  }

  const request = detectRequestSignal(normalized);
  if (request?.kind === "blocker" || matchesAny(normalized, BLOCKER_PATTERNS)) {
    return {
      signal_type: "blocker",
      signal_confidence: 0.82,
      title: defaultTitleForType("blocker", normalized),
      summary: request?.reason ?? normalized.slice(0, 200),
      action_key: null,
      action_family: "blocker",
      priority: "high",
    };
  }

  if (matchesAny(normalized, SCOPE_PATTERNS)) {
    return {
      signal_type: "scope_change",
      signal_confidence: 0.8,
      title: defaultTitleForType("scope_change", normalized),
      summary: normalized.slice(0, 200),
      action_key: null,
      action_family: "scope_change",
      priority: "medium",
    };
  }

  if (matchesAny(normalized, DECISION_PATTERNS)) {
    return {
      signal_type: "decision",
      signal_confidence: 0.78,
      title: defaultTitleForType("decision", normalized),
      summary: normalized.slice(0, 200),
      action_key: null,
      action_family: "decision",
      priority: "medium",
    };
  }

  if (matchesAny(normalized, CLIENT_QUESTION_PATTERNS) || request?.kind === "request") {
    const isClientActor = ctx?.actor_classification === "client";
    const isExternalChannel = ctx?.link_type === "external" || ctx?.is_client_facing === true;
    if (ctx?.actor_classification === "internal") {
      const work = inferWorkRequestClassification(normalized, ctx);
      if (work) return work;
    }
    if (!isClientActor && !isExternalChannel && ctx?.actor_classification !== "client") {
      return {
        signal_type: "general_action",
        signal_confidence: 0.7,
        title: normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized,
        summary: `Slack message may need clarification: ${normalized.slice(0, 180)}`,
        action_key: null,
        action_family: "slack_request",
        priority: "medium",
        suggested_action_type: "manual",
      };
    }
    return {
      signal_type: "client_question",
      signal_confidence: 0.76,
      title: defaultTitleForType("client_question", normalized),
      summary: normalized.slice(0, 200),
      action_key: null,
      action_family: "client_question",
      priority: "medium",
      suggested_action_type: "ask_client_question",
    };
  }

  if (matchesAny(normalized, PROGRESS_PATTERNS)) {
    return {
      signal_type: "progress_update",
      signal_confidence: 0.72,
      title: defaultTitleForType("progress_update", normalized),
      summary: normalized.slice(0, 200),
      action_key: null,
      action_family: "progress_update",
      priority: "low",
    };
  }

  if (normalized.length < 20 && !matchesAny(normalized, WORK_REQUEST_PATTERNS)) {
    return {
      signal_type: "noise",
      signal_confidence: 0.7,
      title: "Short message",
      summary: normalized,
      action_key: null,
      action_family: null,
      priority: "low",
    };
  }

  return {
    signal_type: "noise",
    signal_confidence: 0.55,
    title: "Unclassified Slack message",
    summary: normalized.slice(0, 200),
    action_key: null,
    action_family: null,
    priority: "low",
  };
}

export function isMeaningfulSlackSignal(signalType: string | null | undefined): boolean {
  return !!signalType && signalType !== "noise" && signalType !== "resolved";
}
