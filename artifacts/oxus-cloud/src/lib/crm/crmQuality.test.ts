import { describe, expect, it } from "vitest";
import { parseDomainInput } from "./domain";
import { classifyEmailSender, isInfrastructureHost, isRoleInboxLocalPart, shouldCreateCompanyFromDomain } from "./senderClassification";
import { resolvePersonName } from "./personNaming";
import { resolveCompanyName } from "./companyNaming";
import { classifyCompanyRelationship } from "./relationshipClassification";
import { confidenceToBand, pickPrimaryContact, scorePrimaryContact } from "./confidence";

describe("parseDomainInput", () => {
  it("extracts registrable domain and subdomain", () => {
    const r = parseDomainInput("bcc.eu1.hubspot.com");
    expect(r.registrableDomain).toBe("hubspot.com");
    expect(r.subdomain).toBe("bcc.eu1");
  });

  it("normalizes app subdomain", () => {
    const r = parseDomainInput("app.example.com");
    expect(r.registrableDomain).toBe("example.com");
    expect(r.subdomain).toBe("app");
  });
});

describe("senderClassification", () => {
  it("detects free email", () => {
    expect(classifyEmailSender("person@gmail.com").category).toBe("free_email");
  });

  it("detects role inbox", () => {
    expect(isRoleInboxLocalPart("hello")).toBe(true);
    expect(classifyEmailSender("hello@company.com").isRoleInbox).toBe(true);
  });

  it("detects automated verify sender", () => {
    expect(classifyEmailSender("verify@upwork.com").category).toBe("automated_sender");
  });

  it("flags infrastructure hosts", () => {
    expect(isInfrastructureHost("auth.firecrawl.dev")).toBe(true);
    expect(shouldCreateCompanyFromDomain("auth.firecrawl.dev")).toBe(false);
  });
});

describe("personNaming", () => {
  it("does not use hello as human name", () => {
    const r = resolvePersonName({ email: "hello@company.com" });
    expect(r.displayName).toBe("General inbox");
    expect(r.isRoleInbox).toBe(true);
  });

  it("rejects numeric names", () => {
    const r = resolvePersonName({ email: "148189634@example.com", displayName: "148189634" });
    expect(r.shouldSuppress).toBe(true);
  });
});

describe("companyNaming", () => {
  it("suppresses infrastructure subdomain companies", () => {
    const r = resolveCompanyName({ domain: "bcc.eu1.hubspot.com" });
    expect(r.shouldSuppress).toBe(true);
  });
});

describe("relationshipClassification", () => {
  it("classifies client with paid invoice evidence", () => {
    const r = classifyCompanyRelationship("acme.com", { hasPaidInvoice: true });
    expect(r.companyType).toBe("client");
  });

  it("does not default to client without evidence", () => {
    const r = classifyCompanyRelationship("unknown.io", {});
    expect(r.companyType).toBe("unknown");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("classifies known platforms as tool", () => {
    const r = classifyCompanyRelationship("stripe.com", {});
    expect(r.companyType).toBe("tool");
  });
});

describe("primaryContact scoring", () => {
  it("penalizes role inboxes", () => {
    const role = scorePrimaryContact({ personId: "a", isRoleInbox: true, hasReliableName: true });
    const human = scorePrimaryContact({ personId: "b", hasReliableName: true, twoWayCount: 3 });
    expect(human.score).toBeGreaterThan(role.score);
  });

  it("returns null when no viable contact", () => {
    expect(pickPrimaryContact([
      scorePrimaryContact({ personId: "a", isRoleInbox: true }),
    ])).toBeNull();
  });
});

describe("confidence bands", () => {
  it("maps scores to bands", () => {
    expect(confidenceToBand(0.92)).toBe("high");
    expect(confidenceToBand(0.7)).toBe("medium");
    expect(confidenceToBand(0.3)).toBe("low");
  });
});
