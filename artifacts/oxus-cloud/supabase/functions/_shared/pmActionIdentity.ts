/** Stable PM action identity keys for idempotent upsert. */



import { normalizeSlug } from "./pmActionDedupe.ts";



/** Thread + action family only — never include signal type or AI-generated title words. */

export function buildSlackActionIdentity(args: {

  projectId: string;

  channelId: string;

  threadTs: string;

  actionFamily: string;

}): string {

  return `slack:${args.projectId}:${args.channelId}:${args.threadTs}:${args.actionFamily}`;

}



export function parseSlackActionIdentity(

  identity: string | null | undefined,

): { projectId: string; channelId: string; threadTs: string; actionFamily: string } | null {

  if (!identity?.startsWith("slack:")) return null;

  const parts = identity.split(":");

  if (parts.length === 5) {

    return {

      projectId: parts[1],

      channelId: parts[2],

      threadTs: parts[3],

      actionFamily: parts[4],

    };

  }

  // Legacy format: slack:project:channel:thread:signalType:actionFamily

  if (parts.length >= 6) {

    return {

      projectId: parts[1],

      channelId: parts[2],

      threadTs: parts[3],

      actionFamily: parts.slice(5).join(":"),

    };

  }

  return null;

}



export function buildClickupActionIdentity(args: {

  projectId: string;

  clickupTaskId: string;

  actionFamily: string;

}): string {

  return `clickup:${args.projectId}:${args.clickupTaskId}:${args.actionFamily}`;

}



export function buildFallbackActionIdentity(args: {

  sourceType: string;

  projectId: string;

  normalizedTitleOrKey: string;

}): string {

  const slug = normalizeSlug(args.normalizedTitleOrKey, "general");

  return `${args.sourceType}:${args.projectId}:${slug}`;

}



const LOGO_FAMILY_GROUP = new Set(["header_logo_update", "logo_update", "header_update"]);



export function actionFamiliesEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {

  if (!a || !b) return false;

  if (a === b) return true;

  return LOGO_FAMILY_GROUP.has(a) && LOGO_FAMILY_GROUP.has(b);

}



export function inferSlackActionFamily(signalType: string, text: string, explicitFamily?: string | null): string {

  if (explicitFamily?.trim()) return normalizeSlug(explicitFamily, signalType);

  const lower = text.toLowerCase();



  if (signalType === "meeting_needed") return "client_meeting";



  if (signalType === "general_action" || isImplementationRequestText(lower)) {

    if (/\b(?:send|prepare|write)\s+(?:a\s+)?(?:weekly|project)\s+update\b/i.test(lower) || /\bweekly\s+update\b/i.test(lower)) {
      return "weekly_update";
    }

    if (/\bmixpanel\b/i.test(lower) && /\bheader\b/i.test(lower)) return "mixpanel_header_snippet";

    if (/\b(?:header|only in the header)\b/i.test(lower) && /\blogo\b/i.test(lower)) {

      return "header_logo_update";

    }

    if (/\blogo\b/i.test(lower)) return "logo_update";

    if (/\bheader\b/i.test(lower)) return "header_update";

    if (/\bsnippet\b/i.test(lower)) return "snippet_install";

    return "work_request";

  }



  if (signalType === "access_needed") return "access_request";

  if (signalType === "client_question") return "client_question";

  if (signalType === "blocker") return "blocker";

  if (signalType === "scope_change") return "scope_change";

  if (signalType === "decision") return "decision";



  return normalizeSlug(signalType, "general");

}



function isImplementationRequestText(lower: string): boolean {

  return (

    /\b(?:add|implement|fix|update|change|replace)\b/i.test(lower) ||

    /\b(?:can|could)\s+someone\s+add\b/i.test(lower) ||

    /\badd\s+(?:a\s+)?(?:mixpanel|snippet|tracking|script|pixel)\b/i.test(lower) ||

    /\b(?:send|prepare|write)\s+(?:a\s+)?(?:weekly|project)\s+update\b/i.test(lower) ||

    /\bweekly\s+update\b/i.test(lower)

  );

}



export function inferActionFamilyFromText(text: string): string {

  return inferSlackActionFamily("general_action", text, null);

}



export function buildActionIdentityForSlackSignal(args: {

  projectId: string;

  channelId: string;

  threadTs: string;

  signalType: string;

  text: string;

  actionFamily?: string | null;

}): string {

  const family = inferSlackActionFamily(args.signalType, args.text, args.actionFamily);

  return buildSlackActionIdentity({

    projectId: args.projectId,

    channelId: args.channelId,

    threadTs: args.threadTs,

    actionFamily: family,

  });

}



export function threadFamilyKeyFromIdentity(identity: string | null | undefined): string | null {

  const parsed = parseSlackActionIdentity(identity);

  if (!parsed) return null;

  return `${parsed.channelId}:${parsed.threadTs}:${parsed.actionFamily}`;

}



export function threadFamilyKeyFromSlackContext(args: {

  channelId: string;

  threadTs: string;

  actionFamily: string;

}): string {

  return `${args.channelId}:${args.threadTs}:${args.actionFamily}`;

}


