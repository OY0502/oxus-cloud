import { describe, expect, it } from "vitest";
import { extractAssigneeNames } from "../../supabase/functions/_shared/slackTaskDraft";

describe("Slack task draft assignee parsing", () => {
  it("extracts every mentioned assignee without throwing", () => {
    expect(extractAssigneeNames("Please ask @Alice and @Bob to follow up")).toEqual([
      "Alice",
      "Bob",
    ]);
  });
});
