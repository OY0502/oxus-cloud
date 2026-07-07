import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildLangfuseTraceUrl, generateStructuredObject, oxusIdentityGuidance } from "./aiModel.ts";
import { patchLangfuseTrace, type TraceMetadata } from "./langfuse.ts";

export type AttentionReconciliationResult = {
  ran: boolean;
  open_before: number;
  resolved_count: number;
  updated_count: number;
  kept_open_count: number;
  superseded_count: number;
  new_questions_count: number;
  resolved_item_ids: string[];
  model?: string;
  langfuse_trace_url?: string | null;
  error?: string;
};

type OpenAttentionItem = {
  id: string;
  question: string;
  reason: string | null;
  importance: string;
  question_key: string | null;
};

type ReconciliationDecision = {
  attention_item_id: string;
  decision: "resolve" | "update" | "keep_open" | "supersede";
  confidence: number;
  answer_summary: string | null;
  evidence: string | null;
  updated_question: string | null;
  reason: string;
};

type ReconciliationOutput = {
  decisions: ReconciliationDecision[];
  new_questions: Array<{ question: string; reason: string; importance: "low" | "medium" | "high" }>;
};

const EMPTY_RESULT: AttentionReconciliationResult = {
  ran: false,
  open_before: 0,
  resolved_count: 0,
  updated_count: 0,
  kept_open_count: 0,
  superseded_count: 0,
  new_questions_count: 0,
  resolved_item_ids: [],
};

function normalizeQuestionKey(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Deterministic rules for obvious answers so we resolve without depending on the
 * model. Each rule matches a question intent AND requires supporting evidence in
 * the new context.
 */
const DETERMINISTIC_RULES: Array<{
  questionMatch: RegExp;
  evidenceMatch: RegExp;
  answer_summary: string;
  evidence: string;
}> = [
  {
    // "Do you already have an existing web app ... improvements vs new/parallel app?"
    questionMatch:
      /(existing|current).{0,40}(web )?app|new\/?\s*parallel|parallel (web )?app|build(ing)? a new|from scratch|greenfield/i,
    evidenceMatch:
      /existing bubble app|existing app|current application|improv(e|ing) the existing|existing .{0,20}(web )?app|redesign(ing)? (the )?current work[- ]?order|existing .{0,20}maintenance|bubble[- ]based/i,
    answer_summary:
      "The client already has an existing Bubble-based maintenance/work-order app. This project is focused on improving the existing application and its workflows (web and mobile), not building a new parallel app.",
    evidence: "New context describes an existing Bubble-based app and a focus on improving current flows.",
  },
];

function serializeMemory(memory: Record<string, unknown> | null | undefined): string {
  if (!memory) return "";
  const keys = [
    "business_goal",
    "target_users",
    "core_flows",
    "scope_in",
    "scope_out",
    "success_criteria",
    "risks",
    "open_questions",
    "delivery_notes",
    "qa_strategy",
  ];
  const subset: Record<string, unknown> = {};
  for (const k of keys) {
    if (memory[k] !== undefined && memory[k] !== null) subset[k] = memory[k];
  }
  return JSON.stringify(subset);
}

/**
 * Review currently OPEN PM attention questions against new context + updated memory and
 * resolve / update / supersede / keep them. Never deletes questions.
 */
export async function reconcileProjectAttentionItems(args: {
  admin: SupabaseClient;
  projectId: string;
  userId: string | null;
  newContextText: string;
  updatedMemory?: Record<string, unknown> | null;
  sourceIds?: string[];
  sourceType?: string;
  sourceTitle?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  agentRunId?: string | null;
  trace?: TraceMetadata;
}): Promise<AttentionReconciliationResult> {
  const { admin, projectId } = args;

  const { data: openRows, error: openErr } = await admin
    .from("project_pm_attention_items")
    .select("id, question, reason, importance, question_key")
    .eq("project_id", projectId)
    .eq("status", "open");
  if (openErr) return { ...EMPTY_RESULT, error: openErr.message };

  const openItems = (openRows ?? []) as OpenAttentionItem[];
  if (openItems.length === 0) return { ...EMPTY_RESULT, ran: false };

  const result: AttentionReconciliationResult = {
    ...EMPTY_RESULT,
    ran: true,
    open_before: openItems.length,
    resolved_item_ids: [],
  };

  const sourceIds = (args.sourceIds ?? []).filter((s): s is string => !!s);
  const memoryText = serializeMemory(args.updatedMemory);
  const evidenceHaystack = `${args.newContextText}\n${memoryText}`;
  const resolvedIds = new Set<string>();
  let aiTraceId: string | null = null;

  // 1) Deterministic pass — resolve obvious cases without the model.
  for (const item of openItems) {
    for (const rule of DETERMINISTIC_RULES) {
      if (rule.questionMatch.test(item.question) && rule.evidenceMatch.test(evidenceHaystack)) {
        const { error } = await admin
          .from("project_pm_attention_items")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
            resolved_by: args.userId,
            resolution_summary: rule.answer_summary,
            resolution_evidence: rule.evidence,
            resolution_source_ids: sourceIds,
            metadata: {
              resolved_by_reconciliation: true,
              deterministic: true,
              agent_run_id: args.agentRunId ?? null,
              source_type: args.sourceType ?? null,
            },
          })
          .eq("id", item.id)
          .eq("project_id", projectId);
        if (!error) {
          resolvedIds.add(item.id);
          result.resolved_count += 1;
          result.resolved_item_ids.push(item.id);
        }
        break;
      }
    }
  }

  const remaining = openItems.filter((i) => !resolvedIds.has(i.id));

  // 2) AI pass for the rest (only if there is meaningful new context).
  if (remaining.length > 0 && args.newContextText.trim().length >= 20) {
    try {
      const { data: suppressedRows } = await admin
        .from("project_pm_attention_items")
        .select("question, status")
        .eq("project_id", projectId)
        .in("status", ["skipped", "cleared", "answered", "resolved"]);

      const schema = `Return STRICT JSON:
{
  "decisions": [
    {
      "attention_item_id": "uuid (must be one of the provided open item ids)",
      "decision": "resolve | update | keep_open | supersede",
      "confidence": 0.0,
      "answer_summary": "string | null",
      "evidence": "string | null",
      "updated_question": "string | null",
      "reason": "string"
    }
  ],
  "new_questions": [
    { "question": "string", "reason": "string", "importance": "low | medium | high" }
  ]
}`;

      const systemPrompt = [
        "You reconcile a project's open 'Needs PM Attention' questions against newly ingested context.",
        "For EACH open question decide: resolve, update, keep_open, or supersede.",
        "resolve ONLY when the new context CLEARLY answers the question (confidence >= 0.7). Provide a short answer_summary and short evidence.",
        "update when partially answered but a narrower question remains — provide updated_question.",
        "supersede when the question should be replaced by a materially better one — provide updated_question.",
        "keep_open when the new context does not answer it.",
        "Do NOT create generic question spam. Max 3 new_questions. Prefer 0.",
        "Do NOT recreate previously skipped/cleared/answered/resolved questions unless materially new context appears.",
        "Evidence must be short and cite the source title if provided.",
        oxusIdentityGuidance({ projectName: args.projectName, clientName: args.clientName }),
        "Output valid JSON only.",
      ].join(" ");

      const userPrompt = [
        `Project: ${args.projectName ?? "(unknown)"}${args.clientName ? ` — client ${args.clientName}` : ""}`,
        `New source${args.sourceTitle ? ` ("${args.sourceTitle}")` : ""}${args.sourceType ? ` [${args.sourceType}]` : ""}:`,
        args.newContextText.slice(0, 12000),
        "",
        "Updated project memory (JSON):",
        memoryText || "{}",
        "",
        "Open PM attention questions (reconcile each by id):",
        JSON.stringify(remaining.map((i) => ({ attention_item_id: i.id, question: i.question, reason: i.reason })), null, 2),
        "",
        "Previously skipped/cleared/answered/resolved questions (do not recreate unless materially new):",
        JSON.stringify((suppressedRows ?? []).map((r) => ({ status: r.status, question: r.question })), null, 2),
      ].join("\n");

      const { data, model, traceId } = await generateStructuredObject<ReconciliationOutput>({
        schemaDescription: schema,
        systemPrompt,
        userPrompt,
        traceName: "reconcileAttentionItems",
        trace: { ...args.trace, prompt_type: "reconcileAttentionItems", open_questions_count: remaining.length },
      });

      result.model = model;
      aiTraceId = traceId;
      result.langfuse_trace_url = buildLangfuseTraceUrl(traceId);

      const validIds = new Set(remaining.map((i) => i.id));
      const questionById = new Map(remaining.map((i) => [i.id, i.question]));

      for (const decision of data.decisions ?? []) {
        if (!validIds.has(decision.attention_item_id) || resolvedIds.has(decision.attention_item_id)) continue;

        if (decision.decision === "resolve" && (decision.confidence ?? 0) >= 0.7) {
          const { error } = await admin
            .from("project_pm_attention_items")
            .update({
              status: "resolved",
              resolved_at: new Date().toISOString(),
              resolved_by: args.userId,
              resolution_summary: decision.answer_summary,
              resolution_evidence: decision.evidence,
              resolution_source_ids: sourceIds,
              metadata: {
                resolved_by_reconciliation: true,
                confidence: decision.confidence,
                reason: decision.reason,
                agent_run_id: args.agentRunId ?? null,
                source_type: args.sourceType ?? null,
              },
            })
            .eq("id", decision.attention_item_id)
            .eq("project_id", projectId);
          if (!error) {
            resolvedIds.add(decision.attention_item_id);
            result.resolved_count += 1;
            result.resolved_item_ids.push(decision.attention_item_id);
          }
        } else if (decision.decision === "update" && decision.updated_question?.trim()) {
          const next = decision.updated_question.trim();
          if (next.toLowerCase() !== (questionById.get(decision.attention_item_id) ?? "").toLowerCase()) {
            const { error } = await admin
              .from("project_pm_attention_items")
              .update({
                question: next,
                question_key: normalizeQuestionKey(next),
                reason: decision.reason || null,
                metadata: { updated_by_reconciliation: true, source_type: args.sourceType ?? null },
              })
              .eq("id", decision.attention_item_id)
              .eq("project_id", projectId);
            if (!error) result.updated_count += 1;
          } else {
            result.kept_open_count += 1;
          }
        } else if (decision.decision === "supersede" && decision.updated_question?.trim()) {
          // Never delete: resolve the old one, then add the better question below.
          const { error } = await admin
            .from("project_pm_attention_items")
            .update({
              status: "resolved",
              resolved_at: new Date().toISOString(),
              resolved_by: args.userId,
              resolution_summary: "Superseded by a more specific question.",
              resolution_evidence: decision.evidence,
              resolution_source_ids: sourceIds,
              metadata: { superseded_by_reconciliation: true, source_type: args.sourceType ?? null },
            })
            .eq("id", decision.attention_item_id)
            .eq("project_id", projectId);
          if (!error) {
            resolvedIds.add(decision.attention_item_id);
            result.superseded_count += 1;
            (data.new_questions ??= []).push({
              question: decision.updated_question.trim(),
              reason: decision.reason || "Refined from a prior question.",
              importance: "medium",
            });
          }
        } else {
          result.kept_open_count += 1;
        }
      }

      // 3) New questions — dedupe against suppressed + currently-open keys.
      const suppressedKeys = new Set(
        (suppressedRows ?? []).map((r) => normalizeQuestionKey(r.question)),
      );
      const { data: currentOpen } = await admin
        .from("project_pm_attention_items")
        .select("question_key")
        .eq("project_id", projectId)
        .eq("status", "open");
      const openKeys = new Set((currentOpen ?? []).map((r) => r.question_key).filter(Boolean) as string[]);

      const newQuestions = (data.new_questions ?? [])
        .filter((q) => q.question?.trim())
        .filter((q) => {
          const key = normalizeQuestionKey(q.question);
          return !suppressedKeys.has(key) && !openKeys.has(key);
        })
        .slice(0, 3);

      if (newQuestions.length > 0) {
        const rows = newQuestions.map((q) => ({
          project_id: projectId,
          question: q.question.trim(),
          reason: q.reason || null,
          importance: ["low", "medium", "high"].includes(q.importance) ? q.importance : "medium",
          blocks_task_creation: false,
          status: "open",
          question_key: normalizeQuestionKey(q.question),
          created_by: args.userId,
          metadata: { created_by_reconciliation: true, agent_run_id: args.agentRunId ?? null },
        }));
        const { error } = await admin.from("project_pm_attention_items").insert(rows);
        if (!error) result.new_questions_count = rows.length;
      }
    } catch (e) {
      // AI reconciliation is best-effort — deterministic resolutions already applied.
      result.error = (e as Error).message;
      console.warn("[attention-reconciliation] AI pass failed:", result.error);
    }
  }

  // Anything not resolved/updated/superseded stays open.
  result.kept_open_count = Math.max(
    0,
    result.open_before - result.resolved_count - result.superseded_count,
  );

  // Enrich the Langfuse trace with reconciliation metadata.
  if (aiTraceId) {
    try {
      await patchLangfuseTrace(aiTraceId, {
        metadata: {
          project_id: projectId,
          agent_run_id: args.agentRunId ?? undefined,
          source_type: args.sourceType,
          open_questions_count: result.open_before,
          resolved_count: result.resolved_count,
          updated_count: result.updated_count,
          kept_open_count: result.kept_open_count,
          new_questions_count: result.new_questions_count,
          model: result.model,
        },
      });
    } catch {
      // ignore trace enrichment failures
    }
  }

  return result;
}
