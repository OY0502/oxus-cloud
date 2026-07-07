import type { ProjectKnowledgeSource, ProjectPmProfile } from "@/lib/types";

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual notes",
  uploaded_file: "Uploaded file",
  zoom_transcript: "Zoom transcript",
  meeting_transcript: "Meeting transcript",
  slack_summary: "Slack summary",
  client_feedback: "Client feedback",
  project_description: "Project description",
  requirements_doc: "Requirements doc",
  design_notes: "Design notes",
  qa_notes: "QA notes",
  technical_notes: "Technical notes",
  delivery_update: "Delivery update",
  unknown: "Unknown",
  figma: "Figma",
  clickup: "ClickUp",
  clickup_doc: "ClickUp doc",
  slack: "Slack",
  agent: "Agent intake",
  company_website: "Company website",
  company_website_page: "Company website",
  other: "Other",
  auto: "Auto-detected",
};

export function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType;
}

export function previewText(text: string | null | undefined, max = 120): string {
  if (!text?.trim()) return "Not captured yet.";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trim()}…`;
}

export function previewList(items: string[], maxItems = 2, maxChars = 80): string {
  if (items.length === 0) return "None captured yet.";
  const slice = items.slice(0, maxItems);
  let text = slice.join(" · ");
  if (items.length > maxItems) text += ` (+${items.length - maxItems} more)`;
  if (text.length > maxChars) text = `${text.slice(0, maxChars).trim()}…`;
  return text;
}

const ACTION_KEYWORDS = [
  "will provide",
  "needs",
  "access",
  "deadline",
  "invite",
  "next meeting",
  "estimate",
  "follow up",
  "confirm",
  "schedule",
];

export function isActionOrientedNote(note: string): boolean {
  const lower = note.toLowerCase();
  return ACTION_KEYWORDS.some((kw) => lower.includes(kw));
}

export function inferQuestionCategory(question: string): string | null {
  const lower = question.toLowerCase();
  if (/\b(design|ui|ux|figma|screen|layout)\b/.test(lower)) return "Design";
  if (/\b(api|backend|database|integration|tech|architecture)\b/.test(lower)) return "Technical";
  if (/\b(budget|timeline|deadline|scope|priority|stakeholder)\b/.test(lower)) return "Scope";
  if (/\b(user|client|customer|audience)\b/.test(lower)) return "Product";
  return null;
}

export function latestSourceInfo(
  profile: ProjectPmProfile | null,
  sources: ProjectKnowledgeSource[],
): { label: string; date: string | null } | null {
  if (sources.length > 0) {
    const latest = sources[0];
    return {
      label: latest.source_title ?? sourceLabel(latest.source_type),
      date: latest.created_at,
    };
  }
  if (profile?.updated_at) {
    return { label: "PM profile", date: profile.updated_at };
  }
  return null;
}
