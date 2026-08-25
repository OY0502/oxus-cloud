import { describe, expect, it } from "vitest";
import { structureAssistantMessage } from "./projectChatFormatting";

describe("project chat answer formatting", () => {
  it("reshapes legacy weekly answers into scannable sections", () => {
    const dense = "This week (cycle 2026-08-21 → 2026-08-28) the team is focused on: finishing Work Orders UX; continuing RRule testing; and checking the document bulk. For the next weekly meeting (scheduled 2026-08-28) the confirmed deliverables to show are: 1) Updated Work Orders designs; 2) RRule test results. Rich Text is finished and in client review with Vegard. Open / missing evidence: whether the bulk verification is complete. Data current as of ClickUp sync 2026-08-24 and Slack sync 2026-08-24.";

    const result = structureAssistantMessage(dense);
    expect(result).toContain("## Weekly plan · 2026-08-21–2026-08-28");
    expect(result).toContain("### In progress");
    expect(result).toContain("- finishing Work Orders UX");
    expect(result).toContain("### Next meeting · 2026-08-28");
    expect(result).toContain("- Updated Work Orders designs");
    expect(result).toContain("### Ready for feedback");
    expect(result).toContain("**Rich Text** is finished");
    expect(result).toContain("### Needs clarification");
    expect(result).toContain("### Source freshness");
  });

  it("preserves responses that already use structured Markdown", () => {
    const markdown = "## Weekly plan\n\n### In progress\n- Work Orders\n- RRule testing";
    expect(structureAssistantMessage(markdown)).toBe(markdown);
  });

  it("breaks generic long prose into shorter paragraphs", () => {
    const prose = "The first point contains enough detail to explain the situation clearly. The second point adds useful supporting context for the project manager. The third point describes the decision that now needs to be made. The fourth point explains the likely next action and its owner. The fifth point records the remaining uncertainty for the team.";
    expect(structureAssistantMessage(prose).split("\n\n").length).toBeGreaterThan(1);
  });

  it("upgrades plain Slack analysis labels into visual Markdown sections", () => {
    const response = "Quick conclusion\n\nThree follow-ups need attention.\n\nAnalysis of Slack activity (what it changed / signalled)\n\n- Calendar decisions were confirmed.\n\nClickUp updates recommended (items you should add/update so work is traceable)\n\n- Update the calendar task.\n\nEvidence freshness\n\nSlack was checked today.";
    const result = structureAssistantMessage(response);

    expect(result).toContain("## Slack & ClickUp review");
    expect(result).toContain("### What changed");
    expect(result).toContain("### ClickUp actions");
    expect(result).toContain("### Source freshness");
  });
});
