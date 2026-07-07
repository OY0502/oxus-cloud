export type TriggerDevConfig = {
  secretKey: string;
  apiUrl: string;
  projectRef?: string;
  previewBranch?: string;
};

export type TriggerDevStatus = {
  secret_key_present: boolean;
  project_ref_present: boolean;
  preview_branch_present: boolean;
  api_url: string;
  configured: boolean;
  client_ready: boolean;
};

export function getTriggerDevStatus(): TriggerDevStatus {
  const secretKey = Deno.env.get("TRIGGER_SECRET_KEY")?.trim();
  const projectRef = Deno.env.get("TRIGGER_PROJECT_REF")?.trim();
  const previewBranch = Deno.env.get("TRIGGER_PREVIEW_BRANCH")?.trim();
  const apiUrl = (Deno.env.get("TRIGGER_API_URL") ?? "https://api.trigger.dev").replace(/\/+$/, "");
  const secret_key_present = !!secretKey;
  const project_ref_present = !!projectRef;
  return {
    secret_key_present,
    project_ref_present,
    preview_branch_present: !!previewBranch,
    api_url: apiUrl,
    configured: secret_key_present,
    client_ready: secret_key_present,
  };
}

export function getTriggerDevConfig(): TriggerDevConfig | null {
  const secretKey = Deno.env.get("TRIGGER_SECRET_KEY")?.trim();
  if (!secretKey) return null;
  return {
    secretKey,
    apiUrl: (Deno.env.get("TRIGGER_API_URL") ?? "https://api.trigger.dev").replace(/\/+$/, ""),
    projectRef: Deno.env.get("TRIGGER_PROJECT_REF")?.trim(),
    previewBranch: Deno.env.get("TRIGGER_PREVIEW_BRANCH")?.trim(),
  };
}

export function isTriggerDevConfigured(): boolean {
  return getTriggerDevStatus().configured;
}

export type TriggerKeyEnvironment = "dev" | "prod" | "staging" | "preview" | "unknown";

/** Infer Trigger.dev environment from the secret key prefix. */
export function getTriggerKeyEnvironment(): TriggerKeyEnvironment {
  const key = Deno.env.get("TRIGGER_SECRET_KEY")?.trim() ?? "";
  if (key.startsWith("tr_prod_")) return "prod";
  if (key.startsWith("tr_dev_")) return "dev";
  if (key.startsWith("tr_stg_")) return "staging";
  if (key.startsWith("tr_preview_")) return "preview";
  return "unknown";
}

/**
 * Whether hosted code should queue Trigger.dev background runs.
 * tr_dev_ only targets the local dev worker (`pnpm trigger:dev`) — not production deploys.
 * Supabase Edge Functions must use tr_prod_ (or tr_stg_) to match `pnpm trigger:deploy`.
 */
export function shouldQueueTriggerDevTasks(): boolean {
  if (!isTriggerDevConfigured()) return false;
  const env = getTriggerKeyEnvironment();
  return env === "prod" || env === "staging";
}

export function triggerDevEnvironmentWarning(): string | null {
  if (!isTriggerDevConfigured()) return null;
  const env = getTriggerKeyEnvironment();
  if (env === "dev") {
    return [
      "TRIGGER_SECRET_KEY is a dev key (tr_dev_).",
      "Hosted Supabase cannot run dev-environment Trigger.dev tasks — sync ran inline instead.",
      "Set tr_prod_ from Trigger.dev → API Keys → Production in Supabase secrets.",
    ].join(" ");
  }
  if (env === "unknown") {
    return "TRIGGER_SECRET_KEY has an unrecognized prefix — ran inline instead of queuing Trigger.dev.";
  }
  return null;
}

export type TriggerTaskResult = {
  id: string;
  url?: string;
  taskIdentifier?: string;
};

function parseTriggerRunId(parsed: Record<string, unknown>): string | null {
  const candidates = [
    parsed.id,
    (parsed.run as Record<string, unknown> | undefined)?.id,
    parsed.runId,
    parsed.handle,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Trigger a Trigger.dev task via REST API (Deno-compatible). */
export async function triggerDevTask(
  taskId: string,
  payload: Record<string, unknown>,
  options?: { idempotencyKey?: string },
): Promise<TriggerTaskResult> {
  const config = getTriggerDevConfig();
  if (!config) {
    throw new Error("Trigger.dev is not configured (TRIGGER_SECRET_KEY missing).");
  }

  console.info("[trigger.dev] triggering task", {
    task_id: taskId,
    api_url: config.apiUrl,
    project_ref_present: !!config.projectRef,
    preview_branch_present: !!config.previewBranch,
    idempotency_key: options?.idempotencyKey ?? null,
  });

  const response = await fetch(`${config.apiUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/trigger`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.secretKey}`,
      ...(config.previewBranch ? { "x-trigger-branch": config.previewBranch } : {}),
    },
    body: JSON.stringify({
      payload,
      ...(options?.idempotencyKey ? { options: { idempotencyKey: options.idempotencyKey } } : {}),
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    console.error("[trigger.dev] trigger failed", {
      task_id: taskId,
      status: response.status,
      body_preview: text.slice(0, 400),
    });
    if (response.status === 422 && text.includes("v3 is no longer supported")) {
      throw new Error(
        "Trigger.dev trigger failed (422): v3 engine rejected. Deploy v4 tasks with `pnpm trigger:deploy`, " +
          "then use the matching environment API key (tr_prod_ for production Supabase, tr_dev_ only while `pnpm trigger:dev` runs). " +
          text.slice(0, 400),
      );
    }
    throw new Error(`Trigger.dev trigger failed (${response.status}): ${text.slice(0, 800)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Trigger.dev returned non-JSON: ${text.slice(0, 400)}`);
  }

  const runId = parseTriggerRunId(parsed);
  if (!runId) {
    console.error("[trigger.dev] response missing run id", { task_id: taskId, keys: Object.keys(parsed) });
    throw new Error("Trigger.dev response missing run id.");
  }

  console.info("[trigger.dev] trigger succeeded", { task_id: taskId, run_id: runId });

  return {
    id: runId,
    url: typeof parsed.url === "string" ? parsed.url : undefined,
    taskIdentifier: typeof parsed.taskIdentifier === "string" ? parsed.taskIdentifier : taskId,
  };
}
