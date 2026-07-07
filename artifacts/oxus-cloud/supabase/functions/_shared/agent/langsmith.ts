export type TraceMetadata = {
  project_id?: string;
  agent_run_id?: string;
  tool_name?: string;
  source_type?: string;
  source?: string;
  runtime?: string;
  model?: string;
};

export function isLangSmithEnabled(): boolean {
  return (
    Deno.env.get("LANGSMITH_TRACING")?.trim().toLowerCase() === "true" &&
    !!Deno.env.get("LANGSMITH_API_KEY")?.trim()
  );
}

export function langSmithProject(): string {
  return Deno.env.get("LANGSMITH_PROJECT")?.trim() || "oxus-cloud";
}

/** Best-effort trace URL for diagnostics (run id from LangSmith is set externally when available). */
export function buildLangSmithTraceUrl(runId?: string | null): string | undefined {
  if (!isLangSmithEnabled() || !runId) return undefined;
  const project = encodeURIComponent(langSmithProject());
  return `https://smith.langchain.com/o/default/projects/p/${project}/r/${runId}`;
}

/** Fire-and-forget run creation for lightweight tracing from Deno edge functions. */
export async function createLangSmithRun(args: {
  name: string;
  runType?: "chain" | "llm" | "tool";
  inputs?: Record<string, unknown>;
  metadata?: TraceMetadata;
  parentRunId?: string;
}): Promise<string | null> {
  if (!isLangSmithEnabled()) return null;
  const apiKey = Deno.env.get("LANGSMITH_API_KEY")!.trim();
  const project = langSmithProject();

  const response = await fetch("https://api.smith.langchain.com/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      name: args.name,
      run_type: args.runType ?? "chain",
      inputs: sanitizeForTrace(args.inputs ?? {}),
      extra: { metadata: sanitizeForTrace(args.metadata ?? {}) },
      project_name: project,
      ...(args.parentRunId ? { parent_run_id: args.parentRunId } : {}),
    }),
  });

  if (!response.ok) {
    console.warn("[langsmith] create run failed:", response.status, (await response.text()).slice(0, 200));
    return null;
  }

  const data = await response.json() as { id?: string };
  return data.id ?? null;
}

export async function patchLangSmithRun(
  runId: string,
  patch: { outputs?: Record<string, unknown>; error?: string },
): Promise<void> {
  if (!isLangSmithEnabled()) return;
  const apiKey = Deno.env.get("LANGSMITH_API_KEY")!.trim();
  await fetch(`https://api.smith.langchain.com/runs/${runId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      outputs: patch.outputs ? sanitizeForTrace(patch.outputs) : undefined,
      error: patch.error,
    }),
  }).catch((e) => console.warn("[langsmith] patch failed:", (e as Error).message));
}

function sanitizeForTrace(value: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    "authorization", "access_token", "api_key", "secret", "password", "token",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (blocked.has(key.toLowerCase())) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = val;
  }
  return out;
}
