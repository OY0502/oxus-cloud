import { describe, expect, it } from "vitest";
import { buildHistoryAwareRetrievalQuery } from "../../supabase/functions/_shared/agent/conversationContext";

describe("history-aware project retrieval", () => {
  it("carries a client question across a later meeting-review request", () => {
    const query = buildHistoryAwareRetrievalQuery("Check in the last 2 meetings and enrich context", [
      { role: "user", content: "The client asked Dima when the Activity planner will be ready for testing." },
      { role: "assistant", content: "I could not find a current Activity planner update in ClickUp." },
      { role: "user", content: "I will upload the latest meeting recordings." },
    ]);

    expect(query).toContain("Activity planner");
    expect(query).toContain("Dima");
    expect(query).toContain("Check in the last 2 meetings");
    expect(query).toContain("Active conversation thread");
  });

  it("does not dilute a detailed standalone request with prior conversation", () => {
    const request = "Prepare a detailed delivery-risk report for the September launch, covering owners, deadlines, dependencies, mitigations, and the latest verified ClickUp status for every open workstream.";
    const query = buildHistoryAwareRetrievalQuery(request, [
      { role: "user", content: "Earlier unrelated discussion about invoice formatting." },
    ]);

    expect(query).toBe(request);
  });

  it("keeps the current question even when prior messages are very long", () => {
    const current = "What did they decide about it?";
    const query = buildHistoryAwareRetrievalQuery(current, Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `message-${index} ${"context ".repeat(500)}`,
    })));

    expect(query.length).toBeLessThanOrEqual(6_000);
    expect(query).toContain(current);
    expect(query).toContain("message-19");
  });
});
