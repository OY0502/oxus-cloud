import { schedules, task, tasks } from "@trigger.dev/sdk";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { getServiceClient, invokeAgentWorker } from "../server/supabase";
import "./googleSyncTasks";

async function workerPost(functionName: string, body: Record<string, unknown>) {
  const resp = await invokeAgentWorker(functionName, body);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `${functionName} failed (${resp.status}): ${text.slice(0, 800)}`,
    );
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown agent error");
}

const execFileAsync = promisify(execFile);
const TEXT_MEETING_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".vtt", ".srt"]);

async function updateMeetingBatchCounts(batchId: string) {
  const admin = getServiceClient();
  const { data: items } = await admin.from("project_meeting_ingestion_items").select("status, progress_percent").eq("batch_id", batchId);
  const rows = items ?? [];
  const completed = rows.filter((item) => item.status === "completed").length;
  const failed = rows.filter((item) => item.status === "failed").length;
  const progress = rows.length ? Math.round(rows.reduce((sum, item) => sum + Number(item.progress_percent ?? 0), 0) / rows.length) : 0;
  await admin.from("project_meeting_ingestion_batches").update({ completed_count: completed, failed_count: failed, progress_percent: progress }).eq("id", batchId);
  return { total: rows.length, completed, failed, progress };
}

async function publishFinalAgentFailure(
  payload: {
    project_id: string;
    agent_run_id: string;
    chat?: boolean;
    chat_session_id?: string;
  },
  error: unknown,
) {
  const admin = getServiceClient();
  const message = errorMessage(error);
  await admin
    .from("project_agent_runs")
    .update({
      status: "failed",
      result_summary: message.slice(0, 500),
      completed_at: new Date().toISOString(),
      raw_response: { error: message },
    })
    .eq("id", payload.agent_run_id);

  if (!payload.chat) return;
  let failureSessionId = payload.chat_session_id;
  if (!failureSessionId) {
    const { data: run } = await admin
      .from("project_agent_runs")
      .select("chat_session_id")
      .eq("id", payload.agent_run_id)
      .maybeSingle();
    failureSessionId = typeof run?.chat_session_id === "string" ? run.chat_session_id : undefined;
  }
  const failedMessage = {
    content: "I couldn't finish that request after retrying. Your message is saved, so you can send it again.",
    metadata: { status: "failed", retry_exhausted: true },
  };
  const { data: existingMessage } = await admin
    .from("project_chat_messages")
    .select("id")
    .eq("agent_run_id", payload.agent_run_id)
    .eq("role", "assistant")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingMessage?.id) {
    await admin.from("project_chat_messages").update(failedMessage).eq("id", existingMessage.id);
  } else if (failureSessionId) {
    await admin.from("project_chat_messages").insert({
      project_id: payload.project_id,
      chat_session_id: failureSessionId,
      user_id: null,
      role: "assistant",
      agent_run_id: payload.agent_run_id,
      ...failedMessage,
    });
  }
}

export const triggerSmokeTestTask = task({
  id: "trigger-smoke-test",
  run: async (payload: { message: string; source?: string }) => {
    console.info(
      "[trigger-smoke-test]",
      payload.message,
      payload.source ?? "unknown",
    );
    await sleep(2000);
    return { ok: true, message: payload.message, at: new Date().toISOString() };
  },
});

export const projectAgentRunTask = task({
  id: "project-agent-run",
  run: async (payload: {
    project_id: string;
    user_id: string;
    agent_run_id: string;
    input_text?: string;
    uploaded_file_ids?: string[];
    mode?: string;
    chat?: boolean;
    chat_session_id?: string;
    chat_action?: "clarification_response";
  }) => {
    const result = await workerPost("project-agent-run-worker", {
      ...payload,
      retry_managed: true,
    });
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    console.info("[project-agent-run] trigger task completed", {
      agent_run_id: payload.agent_run_id,
      status: (result as { status?: string }).status,
    });
    return result;
  },
  onFailure: async ({ payload, error }) => {
    await publishFinalAgentFailure(payload, error);
  },
});

export const processProjectSignalsTask = task({
  id: "process-project-signals",
  run: async (payload: {
    project_id: string;
    user_id?: string;
    limit?: number;
  }) => {
    return workerPost("process-ai-jobs", {
      project_id: payload.project_id,
      limit: payload.limit,
      ensure_pending: true,
      async: false,
    });
  },
});

export const syncSlackProjectChannelTask = task({
  id: "sync-slack-project-channel",
  run: async (payload: { project_id: string; user_id: string }) => {
    return workerPost("slack-sync-project-channel", {
      project_id: payload.project_id,
    });
  },
});

export const syncClickupProjectUpdatesTask = task({
  id: "sync-clickup-project-updates",
  run: async (payload: { project_id: string; user_id: string }) => {
    return workerPost("clickup-sync-project-updates", {
      project_id: payload.project_id,
    });
  },
});

export const clickupInitialProjectScanTask = task({
  id: "clickup-initial-project-scan",
  queue: { name: "clickup-initial-project-scan", concurrencyLimit: 3 },
  maxDuration: 600,
  run: async (payload: { project_id: string; user_id: string }) => {
    return workerPost("clickup-initial-project-scan", payload);
  },
});

export const projectMeetingFileIngestTask = task({
  id: "project-meeting-file-ingest",
  queue: { name: "project-meeting-file-ingest", concurrencyLimit: 3 },
  maxDuration: 3600,
  retry: { maxAttempts: 3 },
  run: async (payload: { batch_id: string; item_id: string; project_id: string; user_id: string }) => {
    const admin = getServiceClient();
    const { data: item, error: itemError } = await admin.from("project_meeting_ingestion_items")
      .select("*, attachment:attachments(id, file_name, file_path, mime_type, file_size)")
      .eq("id", payload.item_id).eq("batch_id", payload.batch_id).single();
    if (itemError || !item?.attachment) throw new Error(itemError?.message ?? "Meeting ingestion item not found.");
    if (item.status === "completed") return { item_id: payload.item_id, skipped: true };
    const attachment = item.attachment as { id: string; file_name: string; file_path: string; mime_type: string | null; file_size: number | null };
    const startedAt = new Date().toISOString();
    await admin.from("project_meeting_ingestion_items").update({ status: "downloading", progress_percent: 5, started_at: startedAt, error_message: null }).eq("id", payload.item_id);
    await updateMeetingBatchCounts(payload.batch_id);

    let workDir: string | null = null;
    try {
      let analysisAttachmentId = attachment.id;
      let transcriptChars = 0;
      const extension = extname(attachment.file_name).toLowerCase();
      if (!TEXT_MEETING_EXTENSIONS.has(extension)) {
        workDir = await mkdtemp(join(tmpdir(), "oxus-meeting-"));
        const inputPath = join(workDir, `input${extension || ".media"}`);
        const { data: signed, error: signedError } = await admin.storage.from("documents").createSignedUrl(attachment.file_path, 3600);
        if (signedError || !signed?.signedUrl) throw new Error(signedError?.message ?? "Could not authorize meeting recording download.");
        const download = await fetch(signed.signedUrl);
        if (!download.ok || !download.body) throw new Error(`Could not download meeting recording (${download.status}).`);
        await pipeline(Readable.fromWeb(download.body as never), createWriteStream(inputPath));
        await admin.from("project_meeting_ingestion_items").update({ status: "transcribing", progress_percent: 15 }).eq("id", payload.item_id);
        await updateMeetingBatchCounts(payload.batch_id);
        const outputPattern = join(workDir, "chunk-%03d.mp3");
        await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
          "-f", "segment", "-segment_time", "600", "-reset_timestamps", "1", outputPattern,
        ], { maxBuffer: 1024 * 1024 * 8 });
        const chunkFiles = (await readdir(workDir)).filter((name) => /^chunk-\d+\.mp3$/.test(name)).sort();
        if (!chunkFiles.length) throw new Error("No audio could be extracted from this recording.");
        const transcriptParts: string[] = [];
        for (let index = 0; index < chunkFiles.length; index += 1) {
          const audio = await readFile(join(workDir, chunkFiles[index]));
          const response = await workerPost("project-meeting-transcribe-chunk", { audio_base64: audio.toString("base64"), format: "mp3" });
          const transcript = typeof response.text === "string" ? response.text.trim() : "";
          if (transcript) transcriptParts.push(`## Recording segment ${index + 1}\n\n${transcript}`);
          const progress = 20 + Math.round(((index + 1) / chunkFiles.length) * 45);
          await admin.from("project_meeting_ingestion_items").update({ progress_percent: progress }).eq("id", payload.item_id);
          await updateMeetingBatchCounts(payload.batch_id);
        }
        const transcript = [`# Transcript · ${attachment.file_name}`, ...transcriptParts].join("\n\n");
        transcriptChars = transcript.length;
        const transcriptPath = `project/${payload.project_id}/meeting-transcripts/${payload.batch_id}/${payload.item_id}.md`;
        const { error: uploadError } = await admin.storage.from("documents").upload(transcriptPath, Buffer.from(transcript, "utf8"), { contentType: "text/markdown", upsert: true });
        if (uploadError) throw new Error(uploadError.message);
        const { data: derived, error: derivedError } = await admin.from("attachments").insert({
          entity_type: "project", entity_id: payload.project_id, doc_type: "attachment", is_active: true,
          file_path: transcriptPath, file_name: `${attachment.file_name}.transcript.md`, file_size: Buffer.byteLength(transcript),
          mime_type: "text/markdown", uploaded_by: payload.user_id,
        }).select("id").single();
        if (derivedError || !derived) throw new Error(derivedError?.message ?? "Could not save transcript.");
        analysisAttachmentId = String(derived.id);
        await admin.from("project_meeting_ingestion_items").update({ derived_attachment_id: analysisAttachmentId, transcript_chars: transcriptChars }).eq("id", payload.item_id);
      }

      await admin.from("project_meeting_ingestion_items").update({ status: "analyzing", progress_percent: 72 }).eq("id", payload.item_id);
      await updateMeetingBatchCounts(payload.batch_id);
      const { data: run, error: runError } = await admin.from("project_agent_runs").insert({
        project_id: payload.project_id, user_id: payload.user_id, input_summary: `Background meeting import: ${attachment.file_name}`,
        status: "running", diagnostics: { runtime: "trigger.dev", meeting_ingestion_batch_id: payload.batch_id, meeting_ingestion_item_id: payload.item_id },
      }).select("id").single();
      if (runError || !run) throw new Error(runError?.message ?? "Could not create meeting analysis run.");
      await admin.from("project_meeting_ingestion_items").update({ agent_run_id: run.id }).eq("id", payload.item_id);
      const result = await workerPost("project-agent-run-worker", {
        project_id: payload.project_id, user_id: payload.user_id, agent_run_id: run.id,
        input_text: "Analyze this meeting thoroughly and merge its decisions, requirements, risks, open questions, and action items into durable project memory. Do not create or change external records.",
        uploaded_file_ids: [analysisAttachmentId], mode: "answer_only", chat: false, retry_managed: true,
      });
      if (result.error) throw new Error(String(result.error));
      const sourceIds = Array.isArray(result.created_source_ids) ? result.created_source_ids : [];
      let chunkCount = 0;
      if (sourceIds.length) {
        const { count } = await admin.from("project_knowledge_chunks").select("id", { count: "exact", head: true }).in("source_id", sourceIds);
        chunkCount = count ?? 0;
      }
      await admin.from("project_meeting_ingestion_items").update({
        status: "completed", progress_percent: 100, transcript_chars: transcriptChars, chunk_count: chunkCount,
        completed_at: new Date().toISOString(), error_message: null,
      }).eq("id", payload.item_id);
      await updateMeetingBatchCounts(payload.batch_id);
      return { item_id: payload.item_id, source_ids: sourceIds, chunk_count: chunkCount };
    } catch (error) {
      const message = errorMessage(error);
      await admin.from("project_meeting_ingestion_items").update({ status: "failed", progress_percent: 100, error_message: message.slice(0, 1000), completed_at: new Date().toISOString() }).eq("id", payload.item_id);
      await updateMeetingBatchCounts(payload.batch_id);
      throw error;
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true });
    }
  },
});

export const projectMeetingBatchTask = task({
  id: "project-meeting-batch",
  queue: { name: "project-meeting-batch", concurrencyLimit: 4 },
  maxDuration: 3600,
  run: async (payload: { batch_id: string; project_id: string; user_id: string; chat_session_id: string }) => {
    const admin = getServiceClient();
    await admin.from("project_meeting_ingestion_batches").update({ status: "processing", started_at: new Date().toISOString(), error_message: null }).eq("id", payload.batch_id);
    const { data: items, error } = await admin.from("project_meeting_ingestion_items").select("id").eq("batch_id", payload.batch_id).order("created_at");
    if (error || !items?.length) throw new Error(error?.message ?? "Meeting batch has no files.");
    await tasks.batchTriggerAndWait("project-meeting-file-ingest", items.map((item) => ({
      payload: { batch_id: payload.batch_id, item_id: item.id, project_id: payload.project_id, user_id: payload.user_id },
      options: { idempotencyKey: `project-meeting-file-ingest:${item.id}` },
    })));
    const counts = await updateMeetingBatchCounts(payload.batch_id);
    const status = counts.failed === 0 ? "completed" : counts.completed > 0 ? "partial" : "failed";
    const completedAt = new Date().toISOString();
    await admin.from("project_meeting_ingestion_batches").update({ status, progress_percent: 100, completed_at: completedAt }).eq("id", payload.batch_id);

    const { data: run, error: runError } = await admin.from("project_agent_runs").insert({
      project_id: payload.project_id, chat_session_id: payload.chat_session_id, user_id: payload.user_id,
      input_summary: `Summarize completed meeting import (${counts.completed}/${counts.total})`, status: "running",
      diagnostics: { runtime: "trigger.dev", meeting_ingestion_batch_id: payload.batch_id },
    }).select("id").single();
    if (!runError && run) {
      try {
        const result = await workerPost("project-agent-run-worker", {
          project_id: payload.project_id, user_id: payload.user_id, agent_run_id: run.id,
          input_text: `The background meeting import finished: ${counts.completed} of ${counts.total} files succeeded and ${counts.failed} failed. Summarize the newly learned project context, decisions, risks, open questions, and action items. Mention failed files without claiming their contents were analyzed.`,
          mode: "answer_only", chat: true, chat_session_id: payload.chat_session_id, retry_managed: true,
        });
        if (result.error) throw new Error(String(result.error));
      } catch (summaryError) {
        await publishFinalAgentFailure({ project_id: payload.project_id, agent_run_id: run.id, chat: true, chat_session_id: payload.chat_session_id }, summaryError);
      }
    }
    return { status, ...counts };
  },
  onFailure: async ({ payload, error }) => {
    const admin = getServiceClient();
    await admin.from("project_meeting_ingestion_batches").update({
      status: "failed", error_message: errorMessage(error).slice(0, 1000), completed_at: new Date().toISOString(),
    }).eq("id", payload.batch_id);
  },
});

export const syncClickupProjectDocsTask = task({
  id: "sync-clickup-project-docs",
  run: async (payload: {
    project_id: string;
    user_id: string;
    tool_run_id?: string;
    sync_all_workspace_docs?: boolean;
  }) => {
    if (payload.tool_run_id) {
      const admin = getServiceClient();
      await admin
        .from("agent_tool_runs")
        .update({ status: "running", confirmed_at: new Date().toISOString() })
        .eq("id", payload.tool_run_id);
    }

    const result = await workerPost("clickup-sync-project-docs", payload);
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }

    if (payload.tool_run_id) {
      const admin = getServiceClient();
      await admin
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          result_payload: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", payload.tool_run_id);
    }
    return result;
  },
});

export const syncClickupHierarchyTask = task({
  id: "sync-clickup-hierarchy",
  run: async (payload: {
    project_id: string;
    user_id: string;
    tool_run_id?: string;
    force?: boolean;
  }) => {
    const admin = getServiceClient();
    if (payload.tool_run_id) {
      await admin
        .from("agent_tool_runs")
        .update({ status: "running", confirmed_at: new Date().toISOString() })
        .eq("id", payload.tool_run_id);
    }
    const result = await workerPost("clickup-sync-project-hierarchy", {
      project_id: payload.project_id,
      user_id: payload.user_id,
      force: payload.force ?? true,
    });
    if (payload.tool_run_id) {
      await admin
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          result_payload: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", payload.tool_run_id);
    }
    return result;
  },
});

export const enrichProjectFromWebsiteTask = task({
  id: "enrich-project-from-website",
  run: async (payload: {
    project_id: string;
    user_id: string;
    company_website_url?: string | null;
    request_message?: string | null;
    proposal_id?: string | null;
    force?: boolean;
  }) => {
    const result = (await workerPost(
      "enrich-project-from-website",
      payload,
    )) as {
      error?: string;
      status?: string;
      pages_scraped?: number;
      sources_created?: number;
      sources_updated?: number;
      initial_intelligence_generated?: boolean;
      langfuse_trace_url?: string;
    };
    if (result.error) {
      throw new Error(String(result.error));
    }
    console.info("[enrich-project-from-website] trigger task completed", {
      project_id: payload.project_id,
      status: result.status,
      pages_scraped: result.pages_scraped,
      sources_created: result.sources_created,
      sources_updated: result.sources_updated,
      initial_intelligence_generated: result.initial_intelligence_generated,
      langfuse_trace_url: result.langfuse_trace_url,
    });
    return result;
  },
});

export const embedProjectKnowledgeTask = task({
  id: "embed-project-knowledge",
  run: async (payload: {
    project_id: string;
    source_id?: string;
    force?: boolean;
  }) => {
    return workerPost("embed-project-knowledge", payload);
  },
});

export const processPineconeKnowledgeOutboxTask = schedules.task({
  id: "process-pinecone-knowledge-outbox",
  cron: {
    // Normal ingestion syncs immediately. This worker drains retries and
    // namespace/source deletions that survived an external outage.
    pattern: "*/5 * * * *",
    timezone: "UTC",
    environments: ["PRODUCTION", "STAGING"],
  },
  run: async () => workerPost("pinecone-chat-memory", { action: "process_outbox" }),
});

export const mergeProjectMemoryFromDocsTask = task({
  id: "merge-project-memory-from-docs",
  run: async (payload: {
    project_id: string;
    user_id: string;
    source_ids?: string[];
    docs_imported?: number;
    docs_updated?: number;
  }) => {
    return workerPost("merge-project-memory-from-docs", payload);
  },
});

export const createClickupTaskFromAgentTask = task({
  id: "create-clickup-task-from-agent",
  run: async (payload: {
    tool_run_id: string;
    user_id: string;
    project_id: string;
    input_payload_overrides?: Record<string, unknown>;
  }) => {
    const admin = getServiceClient();
    try {
      return await workerPost("confirm-agent-tool-run-worker", payload);
    } catch (error) {
      const message = errorMessage(error);
      await admin
        .from("agent_tool_runs")
        .update({
          status: "failed",
          error_message: message.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq("id", payload.tool_run_id);
      throw error;
    }
  },
});

export const createClickupDocFromAgentTask = task({
  id: "create-clickup-doc-from-agent",
  run: async (payload: {
    project_id: string;
    user_id: string;
    tool_run_id?: string;
    title?: string;
    markdown_content?: string;
    input_payload_overrides?: Record<string, unknown>;
  }) => {
    const admin = getServiceClient();
    if (payload.tool_run_id) {
      await admin
        .from("agent_tool_runs")
        .update({ status: "running", confirmed_at: new Date().toISOString() })
        .eq("id", payload.tool_run_id);
    }
    const result = await workerPost("clickup-create-doc-from-agent", {
      project_id: payload.project_id,
      user_id: payload.user_id,
      tool_run_id: payload.tool_run_id,
      title: payload.title,
      markdown_content: payload.markdown_content,
      input_payload_overrides: payload.input_payload_overrides,
    });
    if (payload.tool_run_id && !(result as { error?: string }).error) {
      await admin
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          result_payload: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", payload.tool_run_id);
    }
    return result;
  },
});

export const linkClickupDocToTaskTask = task({
  id: "link-clickup-doc-to-task",
  run: async (payload: {
    tool_run_id: string;
    user_id: string;
    project_id: string;
    input_payload_overrides?: Record<string, unknown>;
  }) => {
    const admin = getServiceClient();
    await admin
      .from("agent_tool_runs")
      .update({ status: "running", confirmed_at: new Date().toISOString() })
      .eq("id", payload.tool_run_id);
    const result = await workerPost("link-clickup-doc-to-task", payload);
    if (!(result as { error?: string }).error) {
      await admin
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          result_payload: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", payload.tool_run_id);
    }
    return result;
  },
});

export const executeAgentWorkflowTask = task({
  id: "execute-agent-workflow",
  run: async (payload: {
    workflow_id: string;
    project_id: string;
    user_id: string;
    step_overrides?: Record<string, Record<string, unknown>>;
  }) => {
    console.info("[execute-agent-workflow] trigger task start", {
      workflow_id: payload.workflow_id,
      project_id: payload.project_id,
    });
    const result = await workerPost("execute-agent-workflow-worker", payload);
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    console.info("[execute-agent-workflow] trigger task completed", {
      workflow_id: payload.workflow_id,
      steps_completed: (result as { steps_completed?: number }).steps_completed,
    });
    return result;
  },
});

export const backfillInvoiceFxTask = task({
  id: "backfill-invoice-fx",
  // TODO: add schedules.task daily at 21:00 Europe/Lisbon once schedule config is wired
  run: async (payload?: { force?: boolean; limit?: number }) => {
    const result = await workerPost("backfill-invoice-fx", {
      force: payload?.force ?? false,
      limit: payload?.limit,
    });
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    console.info("[backfill-invoice-fx] completed", result);
    return result;
  },
});

export const processStripeWebhookEventTask = task({
  id: "process-stripe-webhook-event",
  run: async (payload: { inbox_id?: string; stripe_event_id?: string }) => {
    const result = await workerPost("process-stripe-webhook-event", payload);
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    return result;
  },
});

export const recoverStripeWebhookEventsTask = schedules.task({
  id: "recover-stripe-webhook-events",
  cron: {
    // The webhook dispatches immediately. This is only a low-frequency safety
    // net for a stored event whose async processor crashed.
    pattern: "17 */6 * * *",
    timezone: "UTC",
    environments: ["PRODUCTION", "STAGING"],
  },
  run: async () => {
    const result = await workerPost("stripe-webhook-recovery", {
      action: "retry",
      limit: 50,
    });
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    return result;
  },
});

export const reconcileStripeInvoicePaymentsTask = task({
  id: "reconcile-stripe-invoice-payments",
  run: async (payload?: {
    month?: string;
    invoice_id?: string;
    force?: boolean;
    limit?: number;
  }) => {
    const result = await workerPost("stripe-reconcile-invoice-payments", {
      month: payload?.month,
      invoice_id: payload?.invoice_id,
      force: payload?.force ?? false,
      limit: payload?.limit,
    });
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    console.info("[reconcile-stripe-invoice-payments] completed", result);
    return result;
  },
});

export const crmEnrichCompanyTask = task({
  id: "crm-enrich-company",
  run: async (payload: {
    company_id: string;
    user_id: string;
    website?: string | null;
  }) => {
    return workerPost("crm-enrich-company", payload);
  },
});

export const reconcileCrmImportQualityTask = task({
  id: "reconcile-crm-import-quality",
  run: async (payload?: { dry_run?: boolean; user_id?: string }) => {
    const result = await workerPost("crm-reconcile-import-quality", {
      dry_run: payload?.dry_run ?? false,
    });
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    console.info("[reconcile-crm-import-quality] completed", result);
    return result;
  },
});

export const resolveCompanyLogoTask = task({
  id: "resolve-company-logo",
  run: async (payload: {
    company_id: string;
    domain?: string;
    website_url?: string;
    force_refresh?: boolean;
  }) => {
    return workerPost("resolve-company-logo", payload);
  },
});

export const crmResolverStageTask = task({
  id: "crm-resolver-stage",
  run: async (payload: { run_id: string }) => {
    const result = await workerPost("crm-resolver-worker", {
      action: "run_stage",
      run_id: payload.run_id,
    });
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    return result;
  },
});

export const crmMigrateV2Task = task({
  id: "crm-migrate-v2",
  run: async (payload: { connection_id: string }) => {
    const result = await workerPost("crm-resolver-worker", {
      action: "migrate_account",
      connection_id: payload.connection_id,
    });
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    return result;
  },
});
