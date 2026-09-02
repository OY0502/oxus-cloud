import { describe, expect, it } from "vitest";

describe("project chat architecture", () => {
  it("keeps ordinary chat advisory while allowing confirmation-gated file reviews", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if ((input.chat && !isTaskReview) || mode === \"answer_only\")");
    expect(source).toContain("plan.memory_updates = {}");
    expect(source).toContain("if (isTaskReview)");
    expect(source).toContain('call.tool_name === "create_clickup_task"');
    expect(source).toContain("!input.chat || isClarificationResponse");
  });

  it("applies a current-state freshness policy and bounded chat history", async () => {
    const fs = await import("node:fs/promises");
    const [model, orchestration] = await Promise.all([
      fs.readFile(
        new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url),
        "utf8",
      ),
      fs.readFile(
        new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(model).toContain("Freshness policy: current time is");
    expect(model).toContain("live ClickUp and Slack evidence update their current status");
    expect(orchestration).toContain('.from("project_chat_messages")');
    expect(orchestration).toContain(".limit(8)");
    expect(model).toContain("message.content.slice(0, 1200)");
  });

  it("stores chat through trusted backend code with read-only team RLS", async () => {
    const fs = await import("node:fs/promises");
    const migration = await fs.readFile(
      new URL("../../supabase/migrations/20260823220000_project_chat.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("alter table public.project_chat_messages enable row level security");
    expect(migration).toContain('policy "Team members can read project chat"');
    expect(migration).not.toMatch(/for insert\s+to authenticated/i);
  });

  it("supports multiple deletable chats while keeping project memory shared", async () => {
    const fs = await import("node:fs/promises");
    const [migration, entrypoint, orchestration, chat] = await Promise.all([
      fs.readFile(new URL("../../supabase/migrations/20260824233000_project_chat_sessions.sql", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/project-agent-run/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
    ]);

    expect(migration).toContain("create table if not exists public.project_chat_sessions");
    expect(migration).toContain("chat_session_id uuid references public.project_chat_sessions(id) on delete cascade");
    expect(migration).toContain('policy "Team members can create project chats"');
    expect(migration).toContain('policy "Team members can delete project chats"');
    expect(migration).toContain("prevent_running_project_chat_delete");
    expect(entrypoint).toContain("chat_session_id: chatSessionId");
    expect(orchestration).toContain('.eq("chat_session_id", chatSessionId)');
    expect(orchestration).toContain("projectId: input.project_id");
    expect(chat).toContain("useCreateProjectChatSession");
    expect(chat).toContain("useDeleteProjectChatSession");
    expect(chat).toContain("keeps the project's shared memory and documents");
  });

  it("uses the existing OpenRouter account for embeddings and a lower-cost chat model", async () => {
    const fs = await import("node:fs/promises");
    const [embeddings, model] = await Promise.all([
      fs.readFile(
        new URL("../../supabase/functions/_shared/agent/embeddings.ts", import.meta.url),
        "utf8",
      ),
      fs.readFile(
        new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(embeddings).toContain('provider === "openrouter"');
    expect(embeddings).toContain('"openai/text-embedding-3-small"');
    expect(model).toContain('"openai/gpt-5-mini"');
    expect(model).toContain("session_id:");
    expect(model).toContain("usage: completion.usage ?? {}");
  });

  it("keeps hybrid retrieval service-only and ranks temporal operational evidence first", async () => {
    const fs = await import("node:fs/promises");
    const migration = await fs.readFile(
      new URL(
        "../../supabase/migrations/20260823234500_project_knowledge_temporal_ranking.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("security invoker");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("when r.temporal");
    expect(migration).toContain("'clickup', 'clickup_doc', 'slack', 'slack_summary'");
    expect(migration).toContain("'source_title', s.source_title");
    expect(migration).not.toMatch(/grant execute[\s\S]+to authenticated/i);
  });

  it("accepts large recording batches through durable background ingestion", async () => {
    const fs = await import("node:fs/promises");
    const [chat, trigger, migration, transcriber] = await Promise.all([
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../trigger/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/migrations/20260902120000_project_meeting_ingestion.sql", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/project-meeting-transcribe-chunk/index.ts", import.meta.url), "utf8"),
    ]);

    expect(chat).toContain(".mp3,.mp4,.m4a,.wav,.webm");
    expect(chat).toContain("up to 20 recordings or transcripts");
    expect(chat).toContain("processing continues after you leave");
    expect(chat).not.toContain(".pdf,.doc,.docx");
    expect(trigger).toContain('id: "project-meeting-batch"');
    expect(trigger).toContain('id: "project-meeting-file-ingest"');
    expect(trigger).toContain('"-segment_time", "600"');
    expect(migration).toContain("project_meeting_ingestion_batches");
    expect(migration).toContain("project_meeting_ingestion_items");
    expect(transcriber).toContain("/audio/transcriptions");
    expect(transcriber).toContain('"openai/whisper-1"');
  });

  it("scans a newly connected ClickUp space into knowledge and posts an initial chat summary", async () => {
    const fs = await import("node:fs/promises");
    const [ensure, scan, context] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/clickup-ensure-project-space/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/clickup-initial-project-scan/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectContextStatus.tsx", import.meta.url), "utf8"),
    ]);
    expect(ensure).toContain('triggerDevTask("clickup-initial-project-scan"');
    expect(scan).toContain("include_closed=true");
    expect(scan).toContain('.select("id, name, project_type")');
    expect(scan).not.toContain('.select("id, name, type")');
    expect(scan).toContain('.from("clickup_task_links").upsert');
    expect(scan).toContain('source_type: "clickup"');
    expect(scan).toContain('title: "ClickUp project overview"');
    expect(context).toContain("Connected · scanning existing tasks…");
    expect(context).not.toContain('detail={clickupLink?.last_sync_at ?');
  });

  it("checks uploaded meetings against ClickUp and renders interactive follow-up controls", async () => {
    const fs = await import("node:fs/promises");
    const [orchestration, model, chat] = await Promise.all([
      fs.readFile(
        new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url),
        "utf8",
      ),
      fs.readFile(
        new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url),
        "utf8",
      ),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
    ]);

    expect(orchestration).toContain("loadClickupTaskSnapshot");
    expect(orchestration).toContain("include_closed=true");
    expect(orchestration).toContain("clickup_tasks_checked");
    expect(model).toContain("FILE_REVIEW_SCHEMA");
    expect(model).toContain('type: "json_schema"');
    expect(model).toContain('strict: true');
    expect(model).toContain('reasoningEffort: args.reviewUploadedFiles || args.isChat ? "low"');
    expect(model).toContain("Compare every concrete action item against the Current ClickUp task snapshot");
    expect(chat).toContain("AgentToolConfirmationList");
    expect(chat).toContain(">Clarifications<");
    expect(chat).toContain('chat_action: respondingToClarification ? "clarification_response"');
  });

  it("uses a single desktop workspace viewport without nested sticky panels", async () => {
    const fs = await import("node:fs/promises");
    const [detail, chat] = await Promise.all([
      fs.readFile(new URL("../pages/ProjectDetail.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
    ]);

    expect(detail).toContain("xl:h-[calc(100dvh-8rem)]");
    expect(detail).not.toContain("xl:sticky");
    expect(detail).toContain("<SheetContent");
    expect(detail).toContain("<ProjectTimelinePanel projectId={project.id} limit={4} compact />");
    expect(chat).toContain('presentation="chat"');
  });

  it("uses complete ClickUp review controls, batch clarifications, and two-stage duplicate protection", async () => {
    const fs = await import("node:fs/promises");
    const [confirmation, chat, orchestration, creation, model] = await Promise.all([
      fs.readFile(new URL("../components/ai/AgentToolConfirmation.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/clickupTaskCreation.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url), "utf8"),
    ]);

    expect(confirmation).toContain("ClickupTaskConfirmationFields");
    expect(confirmation).toContain("clickupTaskFormToPayload");
    expect(chat).toContain("clarificationAnswers");
    expect(chat).toContain("Submit answers");
    expect(chat).toContain("withoutDuplicatedClarifications");
    expect(chat).not.toContain("answeringQuestion");
    expect(orchestration).toContain('.from("project_slack_events")');
    expect(orchestration).toContain("const clickupTaskSnapshot = input.chat");
    expect(orchestration).toContain("detectDuplicateTask");
    expect(creation).toContain("assertNoMatchingClickupTask");
    expect(model).toContain("Never include a Questions or Questions to clarify section");
  });

  it("lets the trusted confirmation worker finish an already-running ClickUp action", async () => {
    const fs = await import("node:fs/promises");
    const [orchestration, confirmation, worker, trigger] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/confirm-agent-tool-run/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/confirm-agent-tool-run-worker/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../trigger/index.ts", import.meta.url), "utf8"),
    ]);

    expect(orchestration).toContain("allowRunning?: boolean");
    expect(orchestration).toContain('args.allowRunning === true && toolRun.status === "running"');
    expect(confirmation).toContain("if (isTriggerDevConfigured() && toolRun.tool_name)");
    expect(confirmation).not.toContain("!staleRunning");
    expect(worker).toContain("allowRunning: true");
    expect(trigger).toContain('status: "failed"');
    expect(trigger).toContain("error_message: message.slice(0, 500)");
  });

  it("shows source-linked activity, hides starters while typing, and reloads real ClickUp statuses", async () => {
    const fs = await import("node:fs/promises");
    const [timeline, context, chat, api, taskFields] = await Promise.all([
      fs.readFile(new URL("../components/pm/ProjectTimelinePanel.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectContextStatus.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../hooks/api.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/clickup/ClickupTaskConfirmationFields.tsx", import.meta.url), "utf8"),
    ]);

    expect(timeline).toContain("informativeEventText");
    expect(timeline).toContain("const distinctTimeline = useMemo");
    expect(timeline).toContain("https://app.clickup.com/t/");
    expect(timeline).toContain("https://slack.com/archives/");
    expect(context).toContain("Synced on ${syncLabel}");
    expect(chat).toContain("{!input.trim() && (");
    expect(api).toContain('refetchOnMount: "always"');
    expect(api).toContain("staleTime: 0");
    expect(taskFields).toContain("Loading from ClickUp…");
  });

  it("normalizes ClickUp webhook objects and repairs legacy unknown-task activity", async () => {
    const fs = await import("node:fs/promises");
    const [webhook, repair, statuses, api] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/clickup-webhook/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/repairClickupTimeline.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/clickup-list-statuses/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../hooks/api.ts", import.meta.url), "utf8"),
    ]);

    expect(webhook).toContain("function clickupFieldLabel");
    expect(webhook).toContain('return `cu_h_${historyId}`');
    expect(webhook).toContain("resolveClickupTaskIdentity");
    expect(repair).toContain("before_status: before");
    expect(repair).toContain("after_status: after");
    expect(statuses).toContain("repairMalformedClickupTimeline");
    expect(api).toContain('"clickup-list-statuses"');
    expect(api).toContain("repair_timeline: true");
  });

  it("models weekly cadence and meetings as durable temporal memory without a cron", async () => {
    const fs = await import("node:fs/promises");
    const migration = await fs.readFile(
      new URL("../../supabase/migrations/20260824170000_project_meeting_memory.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("public.project_operating_cadence");
    expect(migration).toContain("cadence_days smallint not null default 7");
    expect(migration).toContain("public.project_meeting_memories");
    expect(migration).toContain("next_meeting_deliverables jsonb");
    expect(migration).toContain("public.project_state_facts");
    expect(migration).not.toMatch(/pg_cron|cron\.schedule/i);
  });

  it("anchors weekly answers on the latest meeting and reconciles live delivery status", async () => {
    const fs = await import("node:fs/promises");
    const [model, orchestration] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
    ]);

    expect(model).toContain("newest structured meeting memory define scope and commitments");
    expect(model).toContain("A task in Client Review, Complete, Live, or Billing is not upcoming implementation work");
    expect(model).toContain("Never turn every active task or every meeting action into a next-meeting deliverable");
    expect(model).toContain("MEETING_MEMORY_JSON_SCHEMA");
    expect(orchestration).toContain("backfillMissingMeetingMemories");
    expect(orchestration).toContain(".slice(0, 2)");
    expect(orchestration).toContain("meetingDateFromSourceTitle");
    expect(orchestration).toContain('from("project_meeting_memories")');
    expect(orchestration).toContain('from("project_operating_cadence")');
  });

  it("persists only explicit PM corrections from ordinary chat", async () => {
    const fs = await import("node:fs/promises");
    const [model, orchestration] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
    ]);

    expect(model).toContain("explicit_user_fact");
    expect(model).toContain("Never store a question, model inference, ClickUp/Slack observation");
    expect(orchestration).toContain("persistProjectFacts");
    expect(orchestration).toContain("fact.explicit_user_fact === true");
    expect(orchestration).toContain('from("project_state_facts")');
  });

  it("requests structured Markdown and renders it as a visual hierarchy", async () => {
    const fs = await import("node:fs/promises");
    const [model, chat] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/aiModel.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
    ]);

    expect(model).toContain("never as one dense paragraph");
    expect(model).toContain('"### Next meeting · date"');
    expect(model).toContain("bullets are only for genuinely parallel action items");
    expect(model).toContain("CHAT_RESPONSE_JSON_SCHEMA");
    expect(model).toContain('name: "project_chat_response"');
    expect(model).toContain('"## Slack & ClickUp review"');
    expect(chat).toContain("structureAssistantMessage");
    expect(chat).toContain("inlineMessageText");
    expect(chat).toContain("AssistantSectionContent");
    expect(chat).toContain("sm:grid-cols-2");
    expect(chat).toContain("divide-y divide-border/55");
  });

  it("does not publish retryable worker attempts as terminal chat failures", async () => {
    const fs = await import("node:fs/promises");
    const [worker, trigger] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/project-agent-run-worker/index.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../trigger/index.ts", import.meta.url), "utf8"),
    ]);

    expect(worker).toContain("if (body.retry_managed)");
    expect(worker).toContain("retrying: true");
    expect(trigger).toContain("retry_managed: true");
    expect(trigger).toContain("onFailure: async");
    expect(trigger).toContain("publishFinalAgentFailure");
  });

  it("persists chat output before publishing terminal run status", async () => {
    const fs = await import("node:fs/promises");
    const [orchestration, chat] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
    ]);

    const chatWrite = orchestration.indexOf('if (input.chat) {', orchestration.indexOf("Persist the visible chat result"));
    const terminalWrite = orchestration.indexOf("const { error: runCompletionError }", chatWrite);
    expect(chatWrite).toBeGreaterThan(-1);
    expect(terminalWrite).toBeGreaterThan(chatWrite);
    expect(orchestration).toContain("Could not save assistant chat response");
    expect(chat).toContain("older workers that may publish terminal status");
    expect(chat).toContain("window.setTimeout(resolve, 500)");
  });

  it("uses Pinecone as the primary retrieval candidate with a shadow rollout and durable lifecycle", async () => {
    const fs = await import("node:fs/promises");
    const [pinecone, retrieval, orchestration, migration] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/pinecone.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/retrieval.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/migrations/20260824230000_pinecone_primary_knowledge.sql", import.meta.url), "utf8"),
    ]);

    expect(pinecone).toContain('DEFAULT_INDEX_NAME = "oxus-project-knowledge-v2"');
    expect(pinecone).toContain("pineconeNamespace(projectId");
    expect(pinecone).toContain('endsWith(".pinecone.io")');
    expect(pinecone).toContain('deletion_protection: "enabled"');
    expect(pinecone).toContain("generatePineconeSparseVectors");
    expect(pinecone).toContain("rerankPinecone");
    expect(pinecone).toContain('metric: config.hybridEnabled ? "dotproduct" : "cosine"');
    expect(retrieval).toContain('mode: "pinecone_hybrid"');
    expect(retrieval).toContain('config.retrievalMode === "primary"');
    expect(retrieval).toContain("diversifyBySource");
    expect(retrieval).toContain("addNeighborContext");
    expect(orchestration).toContain("usePinecone: input.chat === true");
    expect(orchestration).toContain("buildHistoryAwareRetrievalQuery");
    expect(orchestration).toContain("syncPinecone: true");
    expect(migration).toContain("project_knowledge_index_jobs");
    expect(migration).toContain("delete_namespace");
    expect(migration).toContain("claim_project_knowledge_index_jobs");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("locked_at < now() - interval '10 minutes'");
    expect(migration).not.toMatch(/pg_cron|cron\.schedule/i);
  });

  it("resolves shared Slack and ClickUp links live and gates ClickUp comments behind confirmation", async () => {
    const fs = await import("node:fs/promises");
    const [references, orchestration, execution, confirmation, chat] = await Promise.all([
      fs.readFile(new URL("../../supabase/functions/_shared/agent/linkedReferences.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/orchestration.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../../supabase/functions/_shared/agent/executeTools.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/ai/AgentToolConfirmation.tsx", import.meta.url), "utf8"),
      fs.readFile(new URL("../components/projects/ProjectChat.tsx", import.meta.url), "utf8"),
    ]);

    expect(references).toContain("resolveExplicitLinkedReferences");
    expect(references).toContain("conversations.replies");
    expect(references).toContain("fetchClickupTaskComments");
    expect(references).toContain("outside this project's connected channel");
    expect(orchestration).toContain("call.tool_name === explicitClickupAction");
    expect(orchestration).toContain("generateClickupCommentDraft");
    expect(orchestration).toContain("deterministic-clickup-action-router");
    expect(orchestration).toContain("Nothing will be posted until you confirm");
    expect(orchestration).toContain("explicitlyAllowsMentions(inputText)");
    expect(execution).toContain("executeAddClickupCommentFromToolRun");
    expect(execution).toContain("CLICKUP_BOT_API_TOKEN");
    expect(execution).toContain("comment_preview");
    expect(execution).toContain("actor_name");
    expect(confirmation).toContain("Client tags and @mentions are disabled");
    expect(confirmation).toContain("Comment added successfully");
    expect(confirmation).toContain("Open in ClickUp");
    expect(confirmation).toContain('presentation === "chat" && r.status === "succeeded"');
    expect(chat).toContain("<Popover open={chatPickerOpen}");
    expect(chat).not.toContain("<select");
  });
});
