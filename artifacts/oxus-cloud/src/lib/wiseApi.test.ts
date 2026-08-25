import { describe, expect, it } from "vitest";
import {
  findStatementMatches,
  findTransferMatches,
} from "../../supabase/functions/_shared/wiseApi";

describe("findStatementMatches", () => {
  it("finds the requested incoming EUR transaction by amount and counterparty", () => {
    const matches = findStatementMatches([{
      id: "wise-tx-1",
      type: "CREDIT",
      date: "2026-08-10T10:00:00Z",
      amount: { value: 2835, currency: "EUR" },
      details: { senderName: "Vegard Nord", reference: "INV-1042" },
      referenceNumber: "TX-1042",
    }], 2835, "Vegard");

    expect(matches).toEqual([expect.objectContaining({
      source: "balance_statement",
      external_id: "wise-tx-1",
      amount: 2835,
      currency: "EUR",
      direction: "credit",
      counterparty: "Vegard Nord",
      reference: "TX-1042",
    })]);
  });

  it("does not confuse the running balance with the transaction amount", () => {
    expect(findStatementMatches([{
      type: "CREDIT",
      amount: { value: 25, currency: "EUR" },
      runningBalance: { value: 2835, currency: "EUR" },
      details: { senderName: "Vegard" },
    }], 2835, "Vegard")).toEqual([]);
  });
});

describe("findTransferMatches", () => {
  it("finds an outbound transfer when the token only exposes transfers", () => {
    const matches = findTransferMatches([{
      id: 42,
      sourceValue: 2835,
      sourceCurrency: "EUR",
      targetValue: 3000,
      targetCurrency: "USD",
      recipientName: "Vegard",
      status: "outgoing_payment_sent",
      details: { reference: "INV-42" },
    }], 2835, "vegard");

    expect(matches[0]).toEqual(expect.objectContaining({
      external_id: "42",
      amount: 2835,
      currency: "EUR",
      direction: "unknown",
    }));
  });
});
