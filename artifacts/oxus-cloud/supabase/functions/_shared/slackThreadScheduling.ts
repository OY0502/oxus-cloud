import {
  buildSlackMeetingActionKey,
  slackThreadRootFromKey,
} from "./pmActionSuppression.ts";
import { classifySlackMessageText, isMeaningfulSlackSignal } from "./slackSignalClassification.ts";
import { resolveSlackEventMessageText } from "./slackMessageText.ts";

export type SlackThreadMessage = {
  text: string;
  ts: string;
  actor_name?: string | null;
  created_at?: string | null;
};

const DAY_PATTERN =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|week))\b/i;

const RESCHEDULE_PATTERNS: RegExp[] = [
  /\bmove\s+it\s+to\b/i,
  /\bchange\s+(?:it\s+)?to\b/i,
  /\breschedule\s+(?:it\s+)?to\b/i,
  /\binstead\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i,
  /\bwants?\s+to\s+move\s+it\s+to\b/i,
  /\bpush(?:ed)?\s+(?:it\s+)?to\b/i,
  /\bswitch(?:ed)?\s+to\b/i,
];

const RESOLVED_PATTERNS: RegExp[] = [
  /\bmeeting\s+is\s+scheduled\b/i,
  /\bcall\s+is\s+booked\b/i,
  /\bcalendar\s+invite\s+sent\b/i,
  /\binvite\s+sent\b/i,
  /\bdone,?\s+meeting\s+scheduled\b/i,
  /\bwe\s+already\s+scheduled\b/i,
  /\bmeeting\s+has\s+been\s+scheduled\b/i,
  /\bscheduled\s+the\s+(?:meeting|call)\b/i,
  /\bbooked\s+the\s+(?:meeting|call)\b/i,
];

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function extractMeetingDateText(text: string): string | null {
  const match = text.match(DAY_PATTERN);
  return match ? match[1].replace(/\s+/g, " ") : null;
}

function isRescheduleMessage(text: string): boolean {
  return RESCHEDULE_PATTERNS.some((pattern) => pattern.test(text));
}

function isResolvedMessage(text: string): boolean {
  return RESOLVED_PATTERNS.some((pattern) => pattern.test(text));
}

function isSchedulingMessage(text: string): boolean {
  return classifySlackMessageText(text).signal_type === "meeting_needed";
}

export type SlackThreadSchedulingState = {
  threadKey: string;
  isSchedulingThread: boolean;
  isResolved: boolean;
  currentMeetingDate: string | null;
  previousMeetingDate: string | null;
  originalMessage: string;
  latestRelevantMessage: string;
  latestActor: string | null;
  title: string;
  description: string;
  actionKey: string;
  latestTs: string | null;
  originalTs: string | null;
};

export function analyzeSlackThreadScheduling(args: {
  threadKey: string;
  messages: SlackThreadMessage[];
  projectId?: string;
  channelId?: string;
}): SlackThreadSchedulingState | null {
  const sorted = [...args.messages]
    .filter((message) => message.text.trim().length >= 2)
    .sort((a, b) => Number(a.ts.split(".")[0]) - Number(b.ts.split(".")[0]));
  if (sorted.length === 0) return null;

  const schedulingMessages = sorted.filter(
    (message) => isSchedulingMessage(message.text) || isRescheduleMessage(message.text),
  );
  if (schedulingMessages.length === 0) return null;

  const original = schedulingMessages[0];
  const latestResolved = [...sorted].reverse().find((message) => isResolvedMessage(message.text));
  const latestScheduling = [...sorted]
    .reverse()
    .find((message) => isSchedulingMessage(message.text) || isRescheduleMessage(message.text));

  if (!latestScheduling) return null;

  const originalDate = extractMeetingDateText(original.text);
  let currentDate = extractMeetingDateText(latestScheduling.text);
  let previousDate: string | null = null;

  for (const message of sorted) {
    if (isRescheduleMessage(message.text)) {
      const nextDate = extractMeetingDateText(message.text);
      if (nextDate) {
        if (currentDate && currentDate.toLowerCase() !== nextDate.toLowerCase()) {
          previousDate = currentDate;
        }
        currentDate = nextDate;
      }
    }
  }

  if (!previousDate && originalDate && currentDate && originalDate.toLowerCase() !== currentDate.toLowerCase()) {
    previousDate = originalDate;
  }

  const dayLabel = currentDate ? capitalizeWord(currentDate) : null;
  const title = dayLabel ? `Schedule client meeting on ${dayLabel}` : "Schedule client meeting";

  let description = `Slack thread indicates a client meeting needs to be scheduled.`;
  if (previousDate && currentDate) {
    description =
      `Slack thread indicates a client meeting needs to be scheduled. It was initially discussed for ${capitalizeWord(previousDate)}, but a later reply says it should move to ${capitalizeWord(currentDate)}.`;
  } else if (currentDate) {
    description = `A Slack message says a client meeting needs to be scheduled on ${capitalizeWord(currentDate)}.`;
  }

  const parsed = slackThreadRootFromKey(args.threadKey);
  const channelId = args.channelId ?? parsed?.channelId ?? null;
  const threadRootTs = parsed?.rootTs ?? original.ts;
  const actionKey =
    args.projectId && channelId && threadRootTs
      ? buildSlackMeetingActionKey(args.projectId, channelId, threadRootTs)
      : `meeting:slack:${args.threadKey}`;

  return {
    threadKey: args.threadKey,
    isSchedulingThread: true,
    isResolved: !!latestResolved,
    currentMeetingDate: currentDate,
    previousMeetingDate: previousDate,
    originalMessage: original.text,
    latestRelevantMessage: latestScheduling.text,
    latestActor: latestScheduling.actor_name ?? null,
    title,
    description,
    actionKey,
    latestTs: latestScheduling.ts,
    originalTs: original.ts,
  };
}

export function slackEventToThreadMessage(event: Record<string, unknown>): SlackThreadMessage | null {
  const ts = typeof event.slack_ts === "string" ? event.slack_ts : null;
  if (!ts) return null;
  const text = resolveSlackEventMessageText({
    message_text: typeof event.message_text === "string" ? event.message_text : null,
    message_preview: typeof event.message_preview === "string" ? event.message_preview : null,
    raw_payload: (event.raw_payload ?? {}) as Record<string, unknown>,
  });
  if (text.length < 2) return null;
  return {
    text,
    ts,
    actor_name: typeof event.slack_user_name === "string" ? event.slack_user_name : null,
    created_at: typeof event.created_at === "string" ? event.created_at : null,
  };
}

export function isMeaningfulTimelineSignalType(signalType: string | null | undefined): boolean {
  return isMeaningfulSlackSignal(signalType) || signalType === "resolved";
}
