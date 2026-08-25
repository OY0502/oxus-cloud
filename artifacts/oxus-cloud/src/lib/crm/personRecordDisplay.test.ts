import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  formatRelationshipLabel,
  getPersonDisplayState,
} from "./personRecordDisplay";
import type { Contact } from "@/lib/types";

function basePerson(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "p1",
    name: "Unknown contact",
    display_name: "Unknown contact",
    type: "client",
    company: "DEEL",
    client_id: "c1",
    email: "miguel.pita@deel.com",
    primary_email: "miguel.pita@deel.com",
    phone: null,
    relationship_strength: "medium",
    source: "Google Calendar",
    notes: null,
    last_contact_at: null,
    first_name: null,
    last_name: null,
    linkedin_url: null,
    avatar_url: null,
    person_status: "active",
    deactivated_at: null,
    metadata: {},
    profile_id: null,
    job_title: null,
    hourly_rate: null,
    availability: null,
    location: null,
    employment_type: null,
    stack: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    name_confidence: 0.2,
    manually_confirmed: false,
    data_quality_status: "needs_review",
    meeting_count: 3,
    ...overrides,
  };
}

describe("getPersonDisplayState", () => {
  it("shows unknown contact with email and confirmation warning", () => {
    const state = getPersonDisplayState(basePerson());
    expect(state.title).toBe("Unknown contact");
    expect(state.emailLine).toBe("miguel.pita@deel.com");
    expect(state.warning).toBe("Name needs confirmation");
    expect(state.qualityBadge).toBe("Needs review");
  });

  it("shows confirmed name without repeated unknown labels", () => {
    const state = getPersonDisplayState(basePerson({
      name: "Miguel Pita",
      display_name: "Miguel Pita",
      first_name: "Miguel",
      last_name: "Pita",
      manually_confirmed: true,
      name_confidence: 1,
      data_quality_status: "accepted",
      job_title: "Operations Manager",
    }));
    expect(state.title).toBe("Miguel Pita");
    expect(state.subtitle).toBe("Operations Manager at DEEL");
    expect(state.warning).toBeNull();
    expect(state.qualityBadge).toBeNull();
  });

  it("formats relationship labels", () => {
    expect(formatRelationshipLabel("client_contact")).toBe("Client Contact");
    expect(formatRelationshipLabel("decision_maker")).toBe("Decision Maker");
  });
});

describe("confidenceLabel", () => {
  it("maps confidence bands", () => {
    expect(confidenceLabel(0.9)).toBe("High");
    expect(confidenceLabel(0.6)).toBe("Medium");
    expect(confidenceLabel(0.3)).toBe("Low");
  });
});

describe("manual field locking behavior", () => {
  it("manual confirmation clears review state in display", () => {
    const before = getPersonDisplayState(basePerson());
    const after = getPersonDisplayState(basePerson({
      name: "Miguel Pita",
      display_name: "Miguel Pita",
      manually_confirmed: true,
      data_quality_status: "accepted",
      name_confidence: 1,
    }));
    expect(before.qualityBadge).toBe("Needs review");
    expect(after.qualityBadge).toBeNull();
    expect(after.title).toBe("Miguel Pita");
  });
});
