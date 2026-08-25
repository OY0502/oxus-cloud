import { describe, expect, it } from "vitest";
import {
  detectExplicitClickupAction,
  explicitlyAllowsMentions,
  isExplicitClickupCommentRequest,
  removeMentionSyntax,
  selectClickupTaskTarget,
} from "../../supabase/functions/_shared/agent/commentSafety";

describe("ClickUp comment safety", () => {
  it("recognizes explicit comment actions without turning ordinary chat into a mutation", () => {
    expect(isExplicitClickupCommentRequest("Create a comment in ClickUp for the Weglot task")).toBe(true);
    expect(isExplicitClickupCommentRequest("What does the Weglot task say in ClickUp?")).toBe(false);
  });

  it("routes explicit ClickUp commands to the correct confirmation tool", () => {
    expect(detectExplicitClickupAction("Create a comment for the Weglot task in ClickUp")).toBe("add_clickup_comment");
    expect(detectExplicitClickupAction("Create a task in ClickUp for the calendar legend")).toBe("create_clickup_task");
    expect(detectExplicitClickupAction("Write a ClickUp document for the release process")).toBe("create_clickup_doc");
    expect(detectExplicitClickupAction("What is happening in ClickUp this week?")).toBeNull();
  });

  it("selects a unique task by meaningful name tokens and refuses ambiguity", () => {
    const tasks = [
      { id: "1", name: "Weglot implementation" },
      { id: "2", name: "Step 2 translation research" },
      { id: "3", name: "Calendar plugin update" },
    ];
    expect(selectClickupTaskTarget("Create a comment for the Weglot task in ClickUp", tasks)?.id).toBe("1");
    expect(selectClickupTaskTarget("Create a comment for translation in ClickUp", [
      { id: "1", name: "Translation implementation" },
      { id: "2", name: "Translation research" },
    ])).toBeNull();
  });

  it("requires explicit mention permission", () => {
    expect(explicitlyAllowsMentions("Post this comment and tag @Vegard")).toBe(true);
    expect(explicitlyAllowsMentions("Create a comment based on Vegard's message")).toBe(false);
  });

  it("removes mention syntax and direct person callouts when permission is absent", () => {
    const safe = removeMentionSyntax([
      "Thanks — tagging @Vegard and @Polina.",
      "Vegard — please confirm the account is ready.",
      "Decision: Weglot is selected.",
    ].join("\n"));

    expect(safe).not.toContain("@");
    expect(safe).not.toContain("tagging");
    expect(safe).not.toContain("Vegard —");
    expect(safe).toContain("confirm the account is ready");
    expect(safe).toContain("Decision: Weglot is selected");
  });
});
