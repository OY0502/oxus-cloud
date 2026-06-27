import type { Json } from "./database.types";

// Domain types for Agency OS, mirroring the public schema in Supabase.
// Field names are snake_case to match the rows returned by supabase-js.

export type QuoteStage = "new-lead" | "scoping" | "proposal" | "won" | "archived";
export type Urgency = "low" | "normal" | "high";
export type ContactType = "client" | "contractor" | "agent";
export const CONTACT_TYPES: ContactType[] = ["client", "contractor", "agent"];
export type RelationshipStrength = "strong" | "medium" | "weak" | "new";
export type EmploymentType = "employee" | "contractor";
export type MemberStatus = "active" | "inactive";
export type Availability = "full" | "partial" | "busy" | "unavailable";
export type ProjectStatus = "planning" | "in-progress" | "on-hold" | "completed";
export type Priority = "low" | "medium" | "high";
export type ProjectHealth = "on-track" | "at-risk" | "off-track";
export type RiskLevel = "none" | "low" | "medium" | "high";
export type InvoiceStatus = "draft" | "sent" | "viewed" | "partial" | "overdue" | "paid";
export type EventType = "meeting" | "design" | "internal" | "milestone";
export type TransactionType = "income" | "expense";
export type ActivityKind = "success" | "info" | "warning" | "default";

export type ProjectType = "Web App" | "Landing Page" | "IT Consulting" | "Bug Fixing";
export const PROJECT_TYPES: ProjectType[] = ["Web App", "Landing Page", "IT Consulting", "Bug Fixing"];

export type EntityType = "quote" | "project";
export type TaskStatus = "todo" | "doing" | "done";
export type DocType = "attachment" | "msa" | "nda" | "sow" | "other";
export type AiProjectBriefSourceType = "manual" | "zoom_transcript" | "project_description" | "other";
export type AiProjectBriefStatus = "pending" | "completed" | "failed";
export type AiProposedTaskPriority = "low" | "medium" | "high" | "urgent";
export type AiProposedTaskStatus = "pending" | "accepted" | "rejected";

export interface AiQaScenario {
  title: string;
  steps: string[];
  expected_result: string;
  priority: "low" | "medium" | "high";
}

export interface Client {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  name: string;
  type: ContactType;
  company: string | null;
  client_id: string | null;
  email: string | null;
  phone: string | null;
  relationship_strength: RelationshipStrength;
  source: string | null;
  notes: string | null;
  last_contact_at: string | null;
  // Contractor / team fields (used when type === "contractor")
  job_title: string | null;
  hourly_rate: number | null;
  availability: string | null;
  location: string | null;
  employment_type: string | null;
  stack: string[];
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
  job_title: string | null;
  email: string | null;
  avatar_url: string | null;
  location: string | null;
  employment_type: EmploymentType;
  status: MemberStatus;
  availability: Availability;
  hourly_rate: number | null;
  stack: string[];
  unpaid_invoices: number;
  notes: string | null;
  profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberWithStats extends TeamMember {
  active_projects: number;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
  created_at: string;
  updated_at: string;
}

export interface Technology {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

// Unified "Quote" entity (formerly the pipeline "deal"). Drives both the
// Pipeline (kanban) and Quotes (table) views.
export interface Quote {
  id: string;
  number: string | null;
  company: string;
  client_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  organization_id: string | null;
  point_of_contact_id: string | null;
  technology_id: string | null;
  project_type: string | null;
  budget: number;
  stage: QuoteStage;
  urgency: Urgency;
  next_action: string | null;
  project_name: string | null;
  project_description: string | null;
  tags: string[];
  owner_id: string | null;
  assigned_user_id: string | null;
  converted_project_id: string | null;
  position: number;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
}

export interface QuoteWithRefs extends Quote {
  organization: Client | null;
  point_of_contact: Contact | null;
  technology: Technology | null;
  assigned_user: Profile | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  client_id: string | null;
  client_name: string | null;
  status: ProjectStatus;
  priority: Priority;
  health: ProjectHealth;
  risk: RiskLevel;
  progress: number;
  budget: number;
  start_date: string | null;
  deadline: string | null;
  is_draft: boolean;
  draft_step: number;
  source_quote_id: string | null;
  organization_id: string | null;
  point_of_contact_id: string | null;
  technology_id: string | null;
  owner_id: string | null;
  project_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithAssignees extends Project {
  /** @deprecated Legacy app-user assignees; prefer team_contacts. */
  assignees: Profile[];
  team_contacts: Contact[];
  owner: Profile | null;
}

export interface AiProjectBrief {
  id: string;
  project_id: string;
  source_type: AiProjectBriefSourceType;
  source_text: string;
  summary: string | null;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  risks: string[];
  open_questions: string[];
  qa_notes: string[];
  raw_response: Json | null;
  model: string | null;
  status: AiProjectBriefStatus;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiProposedTask {
  id: string;
  project_id: string;
  brief_id: string | null;
  title: string;
  description: string | null;
  acceptance_criteria: string[];
  qa_scenarios: AiQaScenario[];
  priority: AiProposedTaskPriority;
  confidence: number | null;
  status: AiProposedTaskStatus;
  raw_item: Json | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type NewAiProjectBrief = Pick<AiProjectBrief, "project_id" | "source_type" | "source_text">;

export type UpdateAiProposedTaskStatus = {
  id: string;
  project_id: string;
  status: AiProposedTaskStatus;
};

export interface Comment {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: Profile | null;
}

export interface Task {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  assignee?: Profile | null;
}

export interface Attachment {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  doc_type: DocType;
  is_active: boolean;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface LineItem {
  id: string;
  description: string;
  amount: number;
  position: number;
}

export interface Invoice {
  id: string;
  number: string;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  project: string | null;
  amount: number;
  amount_paid: number;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  paid_date: string | null;
  payment_method: string | null;
  owner_id: string | null;
  owner_name: string | null;
  last_reminder_at: string | null;
  stripe_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithItems extends Invoice {
  line_items: LineItem[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  type: EventType;
  location: string | null;
  color: string | null;
  project_id: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventWithAttendees extends CalendarEvent {
  attendees: Profile[];
}

export interface Transaction {
  id: string;
  occurred_on: string;
  description: string;
  amount: number;
  category: string;
  type: TransactionType;
  client_id: string | null;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  contact_id: string | null;
  created_at: string;
}
