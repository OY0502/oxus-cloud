import { describe, expect, it } from "vitest";

describe("Slack project knowledge architecture", () => {
  it("turns linked Slack threads into durable source-linked knowledge", async () => {
    const fs = await import("node:fs/promises");
    const [memory, webhook, reprocess, migration] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/slackKnowledgeMemory.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/slack-events/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/reprocessSlackEvents.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/migrations/20260825123000_slack_thread_knowledge.sql", import.meta.url), "utf8"),
    ]);

    expect(memory).toContain('memory_kind: "slack_thread"');
    expect(memory).toContain('source_type: "slack_summary"');
    expect(memory).toContain('external_provider: "slack"');
    expect(memory).toContain('"Decisions"');
    expect(memory).toContain('"Questions and clarifications"');
    expect(memory).toContain('"Requirements and scope"');
    expect(memory).toContain('"Risks and blockers"');
    expect(memory).toContain('"Actions and follow-ups"');
    expect(memory).toContain("canonical_url: permalink");
    expect(memory).toContain("chunkKnowledgeText");
    expect(webhook).toContain("syncSlackThreadKnowledge");
    expect(reprocess).toContain("syncSlackThreadKnowledge");
    expect(migration).toContain("idx_project_knowledge_sources_slack_thread_unique");
  });

  it("supports bounded historical import without adding a Slack polling cron", async () => {
    const fs = await import("node:fs/promises");
    const [link, sync, panel, trigger] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/slack-link-project-channel/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/slack-sync-project-channel/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/slack/ProjectSlackPanel.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../trigger/index.ts", import.meta.url), "utf8"),
    ]);

    expect(link).toContain("history_days?: number");
    expect(link).toContain('sync_mode: historyDays > 0 ? "bounded_history" : "new_messages_only"');
    expect(sync).toContain('"conversations.history"');
    expect(sync).toContain("history_cursor");
    expect(sync).toContain("history_backfill_complete");
    expect(panel).toContain("History to import");
    expect(panel).toContain("Last 90 days · recommended");
    expect(panel).toContain("no extra polling job is added");
    expect(trigger).not.toMatch(/slack[\s\S]{0,120}schedules\.task/i);
  });

  it("feeds all active AI-enabled Slack channels into chat and resolves links per channel", async () => {
    const fs = await import("node:fs/promises");
    const [orchestration, references, model] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/linkedReferences.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url), "utf8"),
    ]);

    expect(orchestration).toContain("const slackLinks =");
    expect(orchestration).toContain("slackLinks.map((link) => loadSlackMessageContext");
    expect(orchestration).toContain("slackLinks,");
    expect(references).toContain("slackLinks?: Record<string, unknown>[]");
    expect(references).toContain("args.slackLinks?.find");
    expect(model).toContain("a client question or proposal is not a decision");
    expect(model).toContain("explicit client feedback, clarification, acceptance, rejection");
  });
});
