import { describe, expect, it } from "vitest";
import { taskDescriptionFromPayload } from "./clickupDocTool";

describe("task confirmation descriptions", () => {
  it("preserves the task description, source context and client quotes over document aliases", () => {
    const description = '## Context\nCarrotz project: checkout page, from the client chat screenshot.\n\n> Keep the delivery note visible.\n\n## Acceptance criteria\n- The note stays visible after changing the address.';
    expect(taskDescriptionFromPayload({ description, content_markdown: "Unrelated document" }))
      .toBe(description);
  });

  it("supports older task payloads using document content fields", () => {
    expect(taskDescriptionFromPayload({ content_markdown: "Legacy task scope" })).toBe("Legacy task scope");
    expect(taskDescriptionFromPayload({ description: "  ", body: "Legacy body" })).toBe("Legacy body");
    expect(taskDescriptionFromPayload({})).toBe("");
  });
});
