import { describe, expect, it } from "vitest";
import { invoiceSelectionForProject, invoiceProjectForCompany, isInvoiceBillingCompany } from "./invoiceProjectSelection";

describe("invoice project selection", () => {
  const lightSend = { id: "lightsend", organization_id: "rateupdate", client_id: "legacy" };
  it("includes project-linked companies even when CRM classifies them as unknown", () => {
    expect(isInvoiceBillingCompany({ id: "rateupdate", company_type: "unknown" }, [lightSend])).toBe(true);
    expect(isInvoiceBillingCompany({ id: "carrotz", company_type: "client" }, [lightSend])).toBe(true);
    expect(isInvoiceBillingCompany({ id: "unrelated", company_type: "tool" }, [lightSend])).toBe(false);
  });
  it("switches from Carrotz to the selected project's billing company", () => {
    expect(invoiceSelectionForProject(lightSend, "carrotz")).toEqual({ projectId: "lightsend", companyId: "rateupdate" });
  });
  it("supports legacy client links and projects without a linked company", () => {
    expect(invoiceSelectionForProject({ id: "legacy", client_id: "client" }, "carrotz").companyId).toBe("client");
    expect(invoiceSelectionForProject({ id: "internal" }, "carrotz").companyId).toBe("carrotz");
  });
  it("clears incompatible projects when the client changes", () => {
    expect(invoiceProjectForCompany(lightSend, "carrotz")).toBe("");
    expect(invoiceProjectForCompany(lightSend, "rateupdate")).toBe("lightsend");
    expect(invoiceProjectForCompany({ id: "internal" }, "carrotz")).toBe("internal");
    expect(invoiceProjectForCompany(undefined, "carrotz")).toBe("");
  });
});
