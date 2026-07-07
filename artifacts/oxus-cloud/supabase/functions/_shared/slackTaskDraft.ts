/** Deterministic Slack message → ClickUp task draft conversion. */

export type ClickupMemberRef = {
  clickup_user_id: string;
  username: string | null;
  email: string | null;
};

export type ProfileNameRef = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type SlackTaskDraftInput = {
  text: string;
  action_family?: string | null;
  channel_name?: string | null;
  source_label?: string | null;
  actor_name?: string | null;
  message_ts?: string | null;
  clickup_members?: ClickupMemberRef[];
  profiles?: ProfileNameRef[];
  reference_date?: Date;
  attachments?: unknown[];
};

export type SlackTaskDraft = {
  title: string;
  description: string;
  assignee_names: string[];
  suggested_clickup_assignee_ids: string[];
  due_date?: string;
  due_date_text?: string;
  priority: "low" | "medium" | "high" | "urgent";
  confidence: number;
  reasoning: string;
};

const POLITE_PREFIX =
  /^(?:hey|hi|hello|quick question|fyi)[,!\s]*/i;
const NAME_ASSIGN_PREFIX =
  /^([A-Z][a-zA-Z'-]+),?\s+(?:could you|can you|please|would you|will you)\b/i;
const CAN_NAME =
  /\b(?:can|could|should)\s+([A-Z][a-zA-Z'-]+)\s+(?:please\s+)?(?:send|add|update|fix|implement|prepare|write|share|complete|do)\b/i;
const ASSIGN_TO = /\bassign(?:\s+this)?\s+to\s+@?([A-Z][a-zA-Z'-]+)\b/i;
const AT_NAME = /@([A-Z][a-zA-Z'-]+)\b/;

function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function endOfWorkWeek(ref: Date): Date {
  const d = new Date(ref);
  d.setHours(12, 0, 0, 0);
  const weekday = d.getDay();
  let delta = 5 - weekday;
  if (delta < 0) delta += 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function nextWeekday(ref: Date, targetDay: number): Date {
  const d = new Date(ref);
  d.setHours(12, 0, 0, 0);
  const weekday = d.getDay();
  let delta = targetDay - weekday;
  if (delta <= 0) delta += 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export function parseDueDateFromText(
  text: string,
  ref: Date = new Date(),
): { due_date?: string; due_date_text?: string } {
  const lower = text.toLowerCase();

  if (/\b(?:by\s+)?eod\b|\bend of day\b/.test(lower)) {
    return { due_date: formatDateYmd(ref), due_date_text: "EOD" };
  }
  if (/\btomorrow\b|\bby tomorrow\b/.test(lower)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    return { due_date: formatDateYmd(d), due_date_text: "tomorrow" };
  }
  if (/\btoday\b|\bby today\b/.test(lower)) {
    return { due_date: formatDateYmd(ref), due_date_text: "today" };
  }
  if (/\b(?:by\s+)?eow\b|\bend of week\b|\bthis week\b/.test(lower)) {
    return { due_date: formatDateYmd(endOfWorkWeek(ref)), due_date_text: "EOW" };
  }

  const byFriday = lower.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (byFriday) {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const idx = days.indexOf(byFriday[1].toLowerCase());
    if (idx >= 0) {
      const d = nextWeekday(ref, idx);
      return { due_date: formatDateYmd(d), due_date_text: `by ${byFriday[1]}` };
    }
  }

  const nextDay = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (nextDay) {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const idx = days.indexOf(nextDay[1].toLowerCase());
    if (idx >= 0) {
      const d = nextWeekday(ref, idx);
      d.setDate(d.getDate() + 7);
      return { due_date: formatDateYmd(d), due_date_text: `next ${nextDay[1]}` };
    }
  }

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return { due_date: iso[1], due_date_text: iso[1] };

  const monthDay = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i);
  if (monthDay) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const m = months.indexOf(monthDay[1].toLowerCase());
    const day = Number(monthDay[2]);
    if (m >= 0 && day >= 1 && day <= 31) {
      const d = new Date(ref.getFullYear(), m, day, 12);
      return { due_date: formatDateYmd(d), due_date_text: `${monthDay[1]} ${day}` };
    }
  }

  return {};
}

export function extractPriorityFromText(text: string): "low" | "medium" | "high" | "urgent" {
  const lower = text.toLowerCase();
  if (/\b(?:urgent|asap|critical|immediately|right away)\b/.test(lower)) return "urgent";
  if (/\bblocked\b|\bblocker\b/.test(lower)) return "high";
  if (/\b(?:not urgent|when possible|low priority|no rush)\b/.test(lower)) return "low";
  if (/\b(?:high priority|important)\b/.test(lower)) return "high";
  if (/\bthis week\b/.test(lower)) return "medium";
  return "medium";
}

export function extractAssigneeNames(text: string): string[] {
  const names = new Set<string>();
  const trimmed = text.trim();

  const prefix = trimmed.match(NAME_ASSIGN_PREFIX);
  if (prefix?.[1]) names.add(prefix[1]);

  const canName = trimmed.match(CAN_NAME);
  if (canName?.[1]) names.add(canName[1]);

  const assignTo = trimmed.match(ASSIGN_TO);
  if (assignTo?.[1]) names.add(assignTo[1]);

  for (const m of trimmed.matchAll(AT_NAME)) {
    if (m[1]) names.add(m[1]);
  }

  return [...names].filter((n) => n.length > 1);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function firstName(value: string): string {
  return normalizeName(value).split(/\s+/)[0] ?? "";
}

export function matchAssigneesToClickupMembers(
  assigneeNames: string[],
  members: ClickupMemberRef[],
  profiles: ProfileNameRef[] = [],
): { ids: string[]; matched: string[]; ambiguous: string[] } {
  const ids = new Set<string>();
  const matched: string[] = [];
  const ambiguous: string[] = [];

  for (const rawName of assigneeNames) {
    const name = normalizeName(rawName);
    const candidates = new Set<string>();

    for (const member of members) {
      const username = member.username ?? "";
      const email = member.email ?? "";
      const un = normalizeName(username);
      const emailLocal = normalizeName(email.split("@")[0] ?? "");
      if (un === name || un.startsWith(`${name} `) || firstName(username) === name) {
        candidates.add(member.clickup_user_id);
      }
      if (emailLocal === name || email === name) {
        candidates.add(member.clickup_user_id);
      }
    }

    for (const profile of profiles) {
      const full = profile.full_name ?? "";
      if (firstName(full) === name || normalizeName(full) === name) {
        for (const member of members) {
          const email = normalizeName(member.email ?? "");
          const profileEmail = normalizeName(profile.email ?? "");
          if (profileEmail && email === profileEmail) {
            candidates.add(member.clickup_user_id);
          }
        }
      }
    }

    const list = [...candidates];
    if (list.length === 1) {
      ids.add(list[0]);
      matched.push(rawName);
    } else if (list.length > 1) {
      ambiguous.push(rawName);
    }
  }

  return { ids: [...ids], matched, ambiguous };
}

function extractRecipientName(text: string): string | null {
  const toPerson = text.match(/\bto\s+([A-Z][a-zA-Z'-]+)\b/);
  return toPerson?.[1] ?? null;
}

function stripPolitePhrasing(text: string): string {
  return text
    .replace(POLITE_PREFIX, "")
    .replace(/^([A-Z][a-zA-Z'-]+),?\s+/i, "")
    .replace(/^(?:could you|can you|please|would you|will you)\s+/i, "")
    .replace(/^(?:someone|anyone)\s+/i, "")
    .replace(/\?\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildImperativeTitle(cleaned: string, actionFamily: string | null, original: string): string {
  const lower = original.toLowerCase();

  if (actionFamily === "header_logo_update" || (/\blogo\b/i.test(lower) && /\bheader\b/i.test(lower))) {
    return "Update header logo";
  }
  if (actionFamily === "mixpanel_header_snippet" || (/\bmixpanel\b/i.test(lower) && /\bheader\b/i.test(lower))) {
    return "Add Mixpanel snippet to app header";
  }
  if (actionFamily === "weekly_update" || /\bweekly\s+update\b/i.test(lower)) {
    const recipient = extractRecipientName(original);
    return recipient ? `Send weekly project update to ${recipient}` : "Send weekly project update";
  }
  if (/\bsend\b/i.test(lower) && /\bupdate\b/i.test(lower)) {
    const recipient = extractRecipientName(original);
    return recipient ? `Send project update to ${recipient}` : "Send project update";
  }
  if (/\badd\b/i.test(lower) && /\bsnippet\b/i.test(lower)) {
    return "Add snippet to app";
  }
  if (/\b(?:add|implement|fix|update|change|replace)\b/i.test(cleaned)) {
    const words = cleaned.split(/\s+/).slice(0, 10).join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  const fallback = cleaned.split(/\s+/).slice(0, 8).join(" ");
  if (fallback.length > 8) {
    return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  }
  return "Review Slack request";
}

function buildTaskBodySentence(original: string, actionFamily: string | null, attachments?: unknown[]): string {
  const lower = original.toLowerCase();
  const recipient = extractRecipientName(original);

  if (actionFamily === "weekly_update" || /\bweekly\s+update\b/i.test(lower)) {
    const timing = /\b(?:by\s+)?eow\b|\bend of week\b/i.test(lower)
      ? " by the end of the week"
      : /\bthis week\b/i.test(lower)
      ? " this week"
      : "";
    return recipient
      ? `Prepare and send a weekly project update to ${recipient}${timing}.`
      : `Prepare and send a weekly project update${timing}.`;
  }
  if (actionFamily === "mixpanel_header_snippet") {
    return "Add a Mixpanel tracking snippet to the app header.";
  }
  if (actionFamily === "header_logo_update") {
    let sentence = "Update the header logo per the Slack request.";
    if (Array.isArray(attachments) && attachments.length > 0) {
      sentence += " The message included an attachment that may be the requested logo asset.";
    }
    return sentence;
  }

  const cleaned = stripPolitePhrasing(original);
  if (cleaned.length > 10) {
    return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}.`;
  }
  return "Complete the requested work from Slack.";
}

function buildDescriptionWithSource(args: {
  bodySentence: string;
  original: string;
  channel_name?: string | null;
  source_label?: string | null;
  actor_name?: string | null;
}): string {
  const lines = [args.bodySentence, ""];
  lines.push("Source: Slack");
  lines.push(`Original message: "${args.original.trim()}"`);
  const channel = args.channel_name ?? args.source_label?.replace(/^#/, "") ?? null;
  if (channel) lines.push(`Channel: #${channel.replace(/^#/, "")}`);
  if (args.actor_name) lines.push(`Requested by: ${args.actor_name}`);
  return lines.join("\n");
}

export function buildTaskDraftFromSlackSignal(input: SlackTaskDraftInput): SlackTaskDraft {
  const original = (input.text ?? "").replace(/\s+/g, " ").trim();
  const ref = input.reference_date ?? new Date();
  const actionFamily = input.action_family ?? null;
  const cleaned = stripPolitePhrasing(original);
  const assigneeNames = extractAssigneeNames(original);
  const { due_date, due_date_text } = parseDueDateFromText(original, ref);
  const priority = extractPriorityFromText(original);
  const title = buildImperativeTitle(cleaned, actionFamily, original);
  const bodySentence = buildTaskBodySentence(original, actionFamily, input.attachments);
  const description = buildDescriptionWithSource({
    bodySentence,
    original,
    channel_name: input.channel_name,
    source_label: input.source_label,
    actor_name: input.actor_name,
  });

  const memberMatch = matchAssigneesToClickupMembers(
    assigneeNames,
    input.clickup_members ?? [],
    input.profiles ?? [],
  );

  let confidence = 0.75;
  let reasoning = "Deterministic Slack task draft.";
  if (assigneeNames.length > 0 && memberMatch.ids.length > 0) {
    confidence += 0.1;
    reasoning += ` Matched assignee ${memberMatch.matched.join(", ")} to ClickUp.`;
  }
  if (due_date) {
    confidence += 0.05;
    reasoning += ` Due date inferred as ${due_date_text ?? due_date}.`;
  }

  return {
    title,
    description,
    assignee_names: assigneeNames,
    suggested_clickup_assignee_ids: memberMatch.ids,
    due_date,
    due_date_text,
    priority,
    confidence: Math.min(confidence, 0.95),
    reasoning,
  };
}

export async function loadClickupMembersForProject(
  admin: { from: (table: string) => ReturnType<import("npm:@supabase/supabase-js@2").SupabaseClient["from"]> },
  projectId: string,
): Promise<ClickupMemberRef[]> {
  const { data: link } = await admin
    .from("project_clickup_links")
    .select("clickup_team_id")
    .eq("project_id", projectId)
    .maybeSingle();
  const teamId = (link as { clickup_team_id?: string } | null)?.clickup_team_id;
  if (!teamId) return [];

  const { data } = await admin
    .from("clickup_members")
    .select("clickup_user_id, username, email")
    .eq("clickup_team_id", teamId)
    .eq("is_active", true);
  return (data ?? []) as ClickupMemberRef[];
}
