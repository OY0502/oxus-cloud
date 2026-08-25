/**
 * Deterministic attendee / sender exclusion for CRM identity resolution.
 */
import { isAutomatedSender, isInternalOxusEmail, normalizeEmail } from "../google-auth.ts";
import { classifyEmailSender, isNumericIdentity } from "../crm/senderClassification.ts";
import type { AttendeeExclusion } from "./types.ts";

const ROOM_PATTERNS = [
  /@resource\.calendar\.google\.com$/i,
  /@group\.calendar\.google\.com$/i,
  /^(room|conf|meeting|calendar)\+/i,
];

export function isRoomOrResourceAttendee(email: string, attendeeMeta?: { resource?: boolean; displayName?: string }): boolean {
  if (attendeeMeta?.resource) return true;
  const name = (attendeeMeta?.displayName ?? "").toLowerCase();
  if (name.includes("room") && name.includes("calendar")) return true;
  return ROOM_PATTERNS.some((p) => p.test(email));
}

export function classifyAttendeeExclusion(args: {
  email: string;
  connectedAccountEmail?: string | null;
  displayName?: string | null;
  resource?: boolean;
}): AttendeeExclusion {
  const email = normalizeEmail(args.email);
  if (!email || !email.includes("@")) return "invalid_email";

  if (args.connectedAccountEmail && email === normalizeEmail(args.connectedAccountEmail)) {
    return "connected_self";
  }
  if (isInternalOxusEmail(email)) return "internal_oxus";
  if (isAutomatedSender(email)) return "automated_sender";

  const sender = classifyEmailSender(email);
  if (sender.isAutomated) return "automated_sender";
  if (sender.isRoleInbox && !sender.isCorporate) return "role_inbox";

  const local = email.split("@")[0] ?? "";
  if (isNumericIdentity(local)) return "bot";

  if (isRoomOrResourceAttendee(email, { resource: args.resource, displayName: args.displayName ?? undefined })) {
    return args.resource ? "resource_calendar" : "room_calendar";
  }

  return null;
}

export function publicationVisibilityFromExclusion(exclusion: AttendeeExclusion): "active" | "needs_review" | "suppressed" {
  if (!exclusion) return "active";
  if (exclusion === "role_inbox") return "needs_review";
  return "suppressed";
}
