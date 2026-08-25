import { generateStructuredObject, oxusIdentityGuidance } from "./agent/aiModel.ts";
import type { TraceMetadata } from "./agent/types.ts";

export function googleClassifierModel(): string {
  return Deno.env.get("GOOGLE_RELATIONSHIP_CLASSIFIER_MODEL")?.trim()
    || Deno.env.get("OPENROUTER_DEFAULT_MODEL")?.trim()
    || "openai/gpt-4.1-mini";
}

export function googleAnalysisModel(): string {
  return Deno.env.get("GOOGLE_RELATIONSHIP_ANALYSIS_MODEL")?.trim()
    || Deno.env.get("OPENROUTER_DEFAULT_MODEL")?.trim()
    || "openai/gpt-5.1";
}

export type RelationshipClassification = {
  relevant: boolean;
  importance: "high" | "medium" | "low" | "ignore";
  company_type: "client" | "prospect" | "partner" | "vendor" | "other" | null;
  person_relationship: "client_contact" | "prospect_contact" | "partner_contact" | "vendor_contact" | "internal" | "other" | null;
  commercial_opportunity: boolean;
  opportunity_signals: string[];
  summary: string;
  confidence: number;
  detected_company_name: string | null;
  detected_company_domain: string | null;
  detected_job_title: string | null;
  detected_person_name: string | null;
  warnings: string[];
};

const SCHEMA = `Return JSON with keys:
relevant (boolean), importance ("high"|"medium"|"low"|"ignore"),
company_type ("client"|"prospect"|"partner"|"vendor"|"other"|null),
person_relationship ("client_contact"|"prospect_contact"|"partner_contact"|"vendor_contact"|"internal"|"other"|null),
commercial_opportunity (boolean), opportunity_signals (string[]),
summary (string, max 240 chars), confidence (0-1 number),
detected_company_name (string|null), detected_company_domain (string|null),
detected_job_title (string|null), detected_person_name (string|null), warnings (string[]).`;

export async function classifyGoogleInteraction(args: {
  interactionType: "email" | "calendar_event" | "contact";
  subject?: string | null;
  snippet?: string | null;
  participantEmails: string[];
  direction?: string | null;
  existingCrmContext?: string;
  trace?: TraceMetadata;
}): Promise<RelationshipClassification> {
  const boundedSnippet = (args.snippet ?? "").slice(0, 2000);
  const userPrompt = [
    `Interaction type: ${args.interactionType}`,
    args.subject ? `Subject: ${args.subject}` : null,
    args.direction ? `Direction: ${args.direction}` : null,
    `Participants: ${args.participantEmails.join(", ")}`,
    boundedSnippet ? `Excerpt:\n${boundedSnippet}` : null,
    args.existingCrmContext ? `Existing CRM context:\n${args.existingCrmContext}` : null,
    "",
    "Rules:",
    "- Ignore newsletters, automated senders, receipts, and spam.",
    "- @oxus.agency participants are internal OXUS team, not external clients.",
    "- Do not invent company facts not supported by the excerpt.",
    "- commercial_opportunity requires explicit service/quote/project intent.",
  ].filter(Boolean).join("\n");

  const { data } = await generateStructuredObject<RelationshipClassification>({
    schemaDescription: SCHEMA,
    systemPrompt: `${oxusIdentityGuidance()}\nYou classify Google relationship signals for OXUS Cloud CRM.`,
    userPrompt,
    trace: { ...args.trace, source_type: args.interactionType, model_tier: "classifier" },
    traceName: "google-relationship-classification",
    model: googleClassifierModel(),
  });

  return {
    ...data,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    opportunity_signals: Array.isArray(data.opportunity_signals) ? data.opportunity_signals : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

export type RelationshipGroupAnalysis = RelationshipClassification & {
  lead_candidate: boolean;
  project_signals: string[];
};

const GROUP_SCHEMA = `${SCHEMA}
Also return lead_candidate (boolean) and project_signals (string[]).`;

export async function analyzeRelationshipGroup(args: {
  externalEmail: string;
  threadCount: number;
  subjects: string[];
  excerpts: string[];
  trace?: TraceMetadata;
}): Promise<RelationshipGroupAnalysis> {
  const boundedExcerpts = args.excerpts.map((e) => e.slice(0, 1200)).slice(0, 5);
  const userPrompt = [
    `External contact: ${args.externalEmail}`,
    `Thread count: ${args.threadCount}`,
    `Subjects: ${args.subjects.slice(0, 8).join(" | ")}`,
    boundedExcerpts.length ? `Recent excerpts:\n${boundedExcerpts.join("\n---\n")}` : null,
    "",
    "Summarize the commercial relationship across these threads. Ignore automated noise.",
  ].filter(Boolean).join("\n");

  const { data, model } = await generateStructuredObject<RelationshipGroupAnalysis>({
    schemaDescription: GROUP_SCHEMA,
    systemPrompt: `${oxusIdentityGuidance()}\nYou analyze grouped Gmail relationship evidence for OXUS Cloud CRM.`,
    userPrompt,
    trace: {
      ...args.trace,
      source_type: "relationship_group",
      model_tier: "analysis",
      thread_count: args.threadCount,
    },
    traceName: "google-relationship-group-analysis",
    model: googleAnalysisModel(),
  });

  return {
    ...data,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    opportunity_signals: Array.isArray(data.opportunity_signals) ? data.opportunity_signals : [],
    project_signals: Array.isArray(data.project_signals) ? data.project_signals : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    lead_candidate: Boolean(data.lead_candidate),
  };
}
