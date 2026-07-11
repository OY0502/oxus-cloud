import { task } from "@trigger.dev/sdk";
import { getServiceClient, invokeAgentWorker } from "../server/supabase";

async function workerPost(functionName: string, body: Record<string, unknown>) {
  const resp = await invokeAgentWorker(functionName, body);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${functionName} failed (${resp.status}): ${text.slice(0, 800)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const triggerSmokeTestTask = task({
  id: "trigger-smoke-test",
  run: async (payload: { message: string; source?: string }) => {
    console.info("[trigger-smoke-test]", payload.message, payload.source ?? "unknown");
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
  }) => {
    const result = await workerPost("project-agent-run-worker", payload);
    if ((result as { error?: string }).error) {
      throw new Error(String((result as { error?: string }).error));
    }
    console.info("[project-agent-run] trigger task completed", {
      agent_run_id: payload.agent_run_id,
      status: (result as { status?: string }).status,
    });
    return result;
  },
});

export const processProjectSignalsTask = task({
  id: "process-project-signals",
  run: async (payload: { project_id: string; user_id?: string; limit?: number }) => {
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
    return workerPost("slack-sync-project-channel", { project_id: payload.project_id });
  },
});

export const syncClickupProjectUpdatesTask = task({
  id: "sync-clickup-project-updates",
  run: async (payload: { project_id: string; user_id: string }) => {
    return workerPost("clickup-sync-project-updates", { project_id: payload.project_id });
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
  run: async (payload: { project_id: string; user_id: string; tool_run_id?: string; force?: boolean }) => {
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
    const result = await workerPost("enrich-project-from-website", payload) as {
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
  run: async (payload: { project_id: string; source_id?: string; force?: boolean }) => {
    return workerPost("embed-project-knowledge", payload);
  },
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
    await admin
      .from("agent_tool_runs")
      .update({ status: "running", confirmed_at: new Date().toISOString() })
      .eq("id", payload.tool_run_id);
    return workerPost("confirm-agent-tool-run-worker", payload);
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

export const reconcileStripeInvoicePaymentsTask = task({
  id: "reconcile-stripe-invoice-payments",
  run: async (payload?: { month?: string; invoice_id?: string; force?: boolean; limit?: number }) => {
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
