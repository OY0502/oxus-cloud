import {
  createLangfuseGeneration,
  createLangfuseTrace,
  patchLangfuseGeneration,
  patchLangfuseTrace,
  type TraceMetadata,
} from "../agent/langfuse.ts";

export async function callTaskGenerationOpenRouter(args: {
  model: string;
  messages: { role: "system" | "user"; content: string }[];
  traceName: string;
  trace?: TraceMetadata;
}): Promise<{ data: Record<string, unknown>; model: string; traceId: string | null; usage?: Record<string, unknown> }> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  const baseUrl = (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const appName = Deno.env.get("OPENROUTER_APP_NAME")?.trim() || "OXUS Cloud";
  const siteUrl = Deno.env.get("OPENROUTER_SITE_URL")?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");

  const traceHandle = await createLangfuseTrace({
    name: args.traceName,
    metadata: { ...args.trace, model: args.model, prompt_type: args.traceName },
    input: { message_count: args.messages.length },
  });
  const generationId = traceHandle
    ? await createLangfuseGeneration({
      traceId: traceHandle.traceId,
      name: args.traceName,
      model: args.model,
      metadata: args.trace,
      input: { message_count: args.messages.length },
    })
    : null;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(siteUrl ? { "HTTP-Referer": siteUrl } : {}),
      "X-Title": appName,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    if (generationId) await patchLangfuseGeneration(generationId, { error: text.slice(0, 500) });
    throw new Error(`OpenRouter error (${response.status}): ${text.slice(0, 800)}`);
  }

  const completion = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
    usage?: Record<string, unknown>;
  };
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenRouter returned empty content.");

  const data = JSON.parse(content) as Record<string, unknown>;
  if (generationId) await patchLangfuseGeneration(generationId, { output: { keys: Object.keys(data) } });
  if (traceHandle) await patchLangfuseTrace(traceHandle.traceId, { output: { ok: true } });

  return {
    data,
    model: args.model,
    traceId: traceHandle?.traceId ?? null,
    usage: completion.usage,
  };
}
