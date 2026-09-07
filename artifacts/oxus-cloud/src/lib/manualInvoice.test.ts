import { describe, expect, it } from "vitest";
import { manualInvoiceTotal, parseManualInvoiceLines } from "./manualInvoice";

describe("manual invoices", () => {
  it("preserves quantities and calculates rounded line totals", () => {
    const lines = parseManualInvoiceLines([
      { description: " Work ", quantity: "1.5", unit_amount: "99.99" },
      { description: "Support", quantity: "2", unit_amount: "10.25" },
    ]);
    expect(lines[0].description).toBe("Work");
    expect(manualInvoiceTotal(lines)).toBe(170.49);
  });
  it("rejects incomplete and invalid lines rather than silently dropping them", () => {
    for (const line of [
      { description: "", quantity: "1", unit_amount: "10" },
      { description: "Work", quantity: "0", unit_amount: "10" },
      { description: "Work", quantity: "1", unit_amount: "-10" },
      { description: "Work", quantity: "Infinity", unit_amount: "10" },
      { description: "Work", quantity: "1", unit_amount: "10abc" },
      { description: "Work", quantity: "1", unit_amount: "1.001" },
    ]) expect(() => parseManualInvoiceLines([line])).toThrow("Line 1:");
    expect(() => parseManualInvoiceLines([])).toThrow("at least one");
  });
  it("the creation screen uses only the internal manual invoice mutation", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../pages/CreateInvoicePage.tsx", import.meta.url), "utf8");
    expect(source).toContain("useCreateManualInvoice");
    expect(source).not.toContain("useStripeCreateInvoice");
    expect(source).not.toContain("finalize_and_send");
    expect(source).toContain("Save manual invoice");
    expect(source).toContain('<SelectItem value="paid">Paid</SelectItem>');
    expect(source).toContain("paid_date");
  });
});
