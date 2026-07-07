import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { traceable } from "langsmith/traceable";

export function openRouterModel() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");
  const baseURL = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const modelId = process.env.OPENROUTER_DEFAULT_MODEL?.trim() || "openai/gpt-5.1";
  const openrouter = createOpenAI({ baseURL, apiKey });
  return { model: openrouter(modelId), modelId };
}

export async function generateStructuredObject<T extends z.ZodTypeAny>(args: {
  schema: T;
  prompt: string;
  system?: string;
  metadata?: Record<string, string>;
}): Promise<{ data: z.infer<T>; model: string }> {
  const run = traceable(
    async () => {
      const { model, modelId } = openRouterModel();
      const { object } = await generateObject({
        model,
        schema: args.schema,
        system: args.system,
        prompt: args.prompt,
      });
      return { data: object as z.infer<T>, model: modelId };
    },
    { name: "generateStructuredObject", metadata: args.metadata },
  );
  return run();
}

const agentPlanSchema = z.object({
  detected_intent: z.string(),
  answer: z.string().nullable().optional(),
  summary: z.string(),
  tool_calls: z.array(z.object({
    tool_name: z.string(),
    input: z.record(z.unknown()),
    requires_confirmation: z.boolean().optional(),
  })).optional(),
});

export async function generateAgentPlan(args: { prompt: string; metadata?: Record<string, string> }) {
  return generateStructuredObject({
    schema: agentPlanSchema,
    system: "OXUS Cloud project agent. Single-shot intake, not chat.",
    prompt: args.prompt,
    metadata: args.metadata,
  });
}

export async function generateTaskDraft(args: { prompt: string }) {
  return generateStructuredObject({
    schema: z.object({
      title: z.string(),
      description: z.string(),
      priority: z.enum(["low", "medium", "high", "urgent"]),
      assignee_hint: z.string().optional(),
      due_date_hint: z.string().optional(),
    }),
    prompt: args.prompt,
  });
}

export async function generateMemoryUpdate(args: { prompt: string }) {
  return generateStructuredObject({
    schema: z.object({
      memory_updates: z.record(z.unknown()),
      summary: z.string(),
    }),
    prompt: args.prompt,
  });
}
