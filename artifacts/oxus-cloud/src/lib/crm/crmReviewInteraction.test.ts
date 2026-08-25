import { describe, expect, it } from "vitest";
import {
  classifyReviewCandidateType,
  countCrmReviewItems,
  entityNeedsReview,
  reviewActionsFor,
  reviewIdentityFor,
  reviewKindLabel,
} from "./reviewQueue";
import { formatLastInteractionAt, formatNextMeetingAt } from "./interactionDates";
import { isActiveInDefaultCrmView, isListableInCrm } from "./visibility";
import { PEOPLE_SAVED_VIEWS, PEOPLE_PRIMARY_VIEW_IDS } from "./savedViews";

describe("crm review queue", () => {
  it("KPI total equals people + companies + leads", () => {
    const counts = countCrmReviewItems([
      { id: "1", entity_type: "person" },
      { id: "2", entity_type: "person" },
      { id: "3", entity_type: "company" },
      { id: "4", entity_type: "lead" },
    ]);
    expect(counts.people).toBe(2);
    expect(counts.companies).toBe(1);
    expect(counts.leads).toBe(1);
    expect(counts.total).toBe(4);
    expect(counts.total).toBe(counts.people + counts.companies + counts.leads);
  });

  it("excludes suppressed merged inactive from entityNeedsReview", () => {
    expect(entityNeedsReview({ visibility_state: "needs_review", data_quality_status: "needs_review" })).toBe(true);
    expect(entityNeedsReview({ visibility_state: "suppressed", data_quality_status: "needs_review" })).toBe(false);
    expect(entityNeedsReview({ visibility_state: "merged", needs_review: true })).toBe(false);
    expect(entityNeedsReview({ visibility_state: "inactive", data_quality_status: "needs_review" })).toBe(false);
    expect(entityNeedsReview({ visibility_state: "active", data_quality_status: "accepted" })).toBe(false);
  });

  it("uses stable review identities so candidate and canonical do not double-count in UI helpers", () => {
    expect(reviewIdentityFor({ id: "abc", entity_type: "person", review_identity: "person:p1" })).toBe("person:p1");
    expect(reviewIdentityFor({ id: "abc", entity_type: "person", matched_person_id: "p1" })).toBe("person:p1");
    expect(reviewIdentityFor({ id: "abc", entity_type: "company", matched_company_id: "c1" })).toBe("company:c1");
    expect(reviewIdentityFor({ id: "abc", entity_type: "person" })).toBe("candidate:abc");
  });

  it("labels review kinds for workspace rows", () => {
    expect(reviewKindLabel("new_suggestion")).toBe("New suggestion");
    expect(reviewKindLabel("existing_needs_review")).toBe("Needs review");
    expect(reviewKindLabel("missing_classification")).toBe("Missing classification");
  });

  it("classifies role inbox and does not offer Add contact as primary", () => {
    const item = {
      id: "1",
      entity_type: "person" as const,
      email: "support@bubble.io",
      review_reason: "Role inbox address, not a personal contact",
    };
    expect(classifyReviewCandidateType(item)).toBe("role_inbox");
    const actions = reviewActionsFor(item);
    expect(actions.primary.action).toBe("link_company_inbox");
    expect(actions.primary.label).not.toMatch(/Add contact/i);
    expect(actions.primary.label).not.toMatch(/^Accept$/i);
  });

  it("classifies automated senders for suppress action", () => {
    const item = {
      id: "2",
      entity_type: "person" as const,
      email: "noreply@stripe.com",
    };
    expect(classifyReviewCandidateType(item)).toBe("automated_sender");
    expect(reviewActionsFor(item).primary.action).toBe("suppress");
  });

  it("offers Add contact for valid person candidates", () => {
    const item = {
      id: "3",
      entity_type: "person" as const,
      email: "jane.doe@acme-corp.example",
      review_kind: "new_suggestion",
    };
    expect(classifyReviewCandidateType(item)).toBe("person_candidate");
    expect(reviewActionsFor(item).primary).toEqual({
      action: "add_as_person",
      label: "Add contact",
    });
  });
});

describe("people visibility after accept", () => {
  it("hides role inbox from default All contacts even when visibility is active", () => {
    expect(isActiveInDefaultCrmView({
      visibility_state: "active",
      data_quality_status: "accepted",
      is_role_inbox: true,
    })).toBe(false);
  });

  it("shows accepted non-role person in default view", () => {
    expect(isActiveInDefaultCrmView({
      visibility_state: "active",
      data_quality_status: "accepted",
      is_role_inbox: false,
    })).toBe(true);
  });

  it("keeps needs_review people listable for Needs review view but not default", () => {
    const person = {
      visibility_state: "needs_review",
      data_quality_status: "needs_review",
      is_role_inbox: false,
    };
    expect(isListableInCrm(person)).toBe(true);
    expect(isActiveInDefaultCrmView(person)).toBe(false);
  });
});

describe("people saved views IA", () => {
  it("defaults to All contacts / My contacts / Unassigned contacts", () => {
    expect(PEOPLE_SAVED_VIEWS[0]).toMatchObject({ id: "all", label: "All contacts", isDefault: true });
    expect(PEOPLE_PRIMARY_VIEW_IDS).toEqual(["all", "my_contacts", "unassigned"]);
    expect(PEOPLE_SAVED_VIEWS.some((v) => v.label === "Active people")).toBe(false);
    expect(PEOPLE_SAVED_VIEWS.some((v) => v.id === "clients")).toBe(false);
  });

  it("treats unassigned as missing owner, not missing company", () => {
    const unassigned = PEOPLE_SAVED_VIEWS.find((v) => v.id === "unassigned");
    expect(unassigned?.filters.unassigned_owner).toBe(true);
    expect(unassigned?.filters.unassigned).toBeUndefined();
  });
});

describe("interaction date display", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it("never shows future timestamps as last interaction", () => {
    expect(formatLastInteractionAt("2026-07-16T13:00:00.000Z", now)).toBe("—");
    expect(formatLastInteractionAt("2026-07-16T13:00:00.000Z", now)).not.toMatch(/^in /);
  });

  it("formats past last interaction", () => {
    const label = formatLastInteractionAt("2026-07-16T10:00:00.000Z", now);
    expect(label).not.toBe("—");
    expect(label).not.toMatch(/^in /);
  });

  it("formats future next meeting and ignores past", () => {
    expect(formatNextMeetingAt("2026-07-16T13:00:00.000Z", now)).toMatch(/in /);
    expect(formatNextMeetingAt("2026-07-16T10:00:00.000Z", now)).toBe("—");
    expect(formatNextMeetingAt(null, now)).toBe("—");
  });
});
