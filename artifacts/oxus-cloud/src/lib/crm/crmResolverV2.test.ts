import { describe, expect, it } from "vitest";

// Mirror of server exclusion rules for unit tests
const INTERNAL = ["@oxus.agency", "@oxus.cloud"];

function normalizeEmail(email: string): string | null {
  const t = email.trim().toLowerCase();
  return t.includes("@") ? t : null;
}

function isInternalOxusEmail(email: string): boolean {
  return INTERNAL.some((s) => email.endsWith(s));
}

function classifyAttendeeExclusion(args: {
  email: string;
  connectedAccountEmail?: string | null;
  resource?: boolean;
}): string | null {
  const email = normalizeEmail(args.email);
  if (!email) return "invalid_email";
  if (args.connectedAccountEmail && email === normalizeEmail(args.connectedAccountEmail)) return "connected_self";
  if (isInternalOxusEmail(email)) return "internal_oxus";
  if (email.includes("resource.calendar.google.com")) return "resource_calendar";
  if (args.resource) return "resource_calendar";
  if (/^(no-reply|noreply|mailer-daemon)@/i.test(email)) return "automated_sender";
  return null;
}

describe("CRM resolver v2 calendar attendee exclusion", () => {
  it("excludes internal OXUS attendees", () => {
    expect(classifyAttendeeExclusion({ email: "hello@oxus.agency" })).toBe("internal_oxus");
  });

  it("excludes connected self account", () => {
    expect(classifyAttendeeExclusion({
      email: "hello@oxus.agency",
      connectedAccountEmail: "hello@oxus.agency",
    })).toBe("connected_self");
  });

  it("excludes resource calendars", () => {
    expect(classifyAttendeeExclusion({
      email: "room-1@resource.calendar.google.com",
      resource: true,
    })).toBe("resource_calendar");
  });

  it("allows external corporate attendee", () => {
    expect(classifyAttendeeExclusion({
      email: "vegard@carrotz.io",
      connectedAccountEmail: "hello@oxus.agency",
    })).toBeNull();
  });

  it("suppresses automated senders", () => {
    expect(classifyAttendeeExclusion({ email: "noreply@stripe.com" })).toBe("automated_sender");
  });
});

describe("CRM resolver v2 identity idempotency key", () => {
  it("uses stable email-based person key", () => {
    const key = normalizeEmail("Vegard@Carrotz.io");
    expect(key).toBe("vegard@carrotz.io");
  });
});
