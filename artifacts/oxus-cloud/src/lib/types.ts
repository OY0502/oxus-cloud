import type { Json } from "./database.types";

// Domain types for Agency OS, mirroring the public schema in Supabase.
// Field names are snake_case to match the rows returned by supabase-js.

export type QuoteStage = "new-lead" | "scoping" | "proposal" | "won" | "archived";
export type Urgency = "low" | "normal" | "high";
export type CompanyType = "internal" | "client" | "prospect" | "partner" | "vendor" | "tool" | "unknown" | "inactive";
export const COMPANY_TYPES: CompanyType[] = ["client", "prospect", "partner", "vendor", "tool", "unknown", "internal", "inactive"];

export type CompanyPersonRelationship =
  | "team_member"
  | "employee"
  | "contractor"
  | "founder"
  | "advisor"
  | "client_contact"
  | "decision_maker"
  | "billing_contact"
  | "technical_contact"
  | "former_employee"
  | "lead"
  | "partner"
  | "vendor_contact"
  | "other";

export type InvoiceProvider = "stripe" | "wise" | "manual" | "other";
export type PayoutProvider = "manual" | "wise" | "bank_transfer" | "stripe" | "other";
export type RateType = "hourly" | "daily" | "monthly" | "fixed_project";
export type ContactType = "client" | "contractor" | "agent" | "lead" | "partner" | "vendor";
export const CONTACT_TYPES: ContactType[] = ["client", "contractor", "agent"];
export type RelationshipStrength = "strong" | "medium" | "weak" | "new";
export type EmploymentType = "employee" | "contractor";
export type MemberStatus = "active" | "inactive";
export type Availability = "full" | "partial" | "busy" | "unavailable";
export type ProjectStatus = "planning" | "in-progress" | "on-hold" | "completed";
export type Priority = "low" | "medium" | "high";
export type ProjectHealth = "on-track" | "at-risk" | "off-track";
export type RiskLevel = "none" | "low" | "medium" | "high";
export type InvoiceStatus = "draft" | "sent" | "viewed" | "partial" | "overdue" | "paid" | "uncollectible" | "void";
export type EventType = "meeting" | "design" | "internal" | "milestone";
export type TransactionType = "income" | "expense";
export type ActivityKind = "success" | "info" | "warning" | "default";

export type ProjectType = "Web App" | "Landing Page" | "IT Consulting" | "Bug Fixing";
export const PROJECT_TYPES: ProjectType[] = ["Web App", "Landing Page", "IT Consulting", "Bug Fixing"];

export type EntityType = "quote" | "project";
export type TaskStatus = "todo" | "doing" | "done";
export type DocType = "attachment" | "msa" | "nda" | "sow" | "other";
export type AiProjectBriefSourceType = "manual" | "zoom_transcript" | "project_description" | "other";
export type InferredKnowledgeSourceType =
  | "meeting_transcript"
  | "slack_summary"
  | "client_feedback"
  | "project_description"
  | "requirements_doc"
  | "design_notes"
  | "qa_notes"
  | "technical_notes"
  | "delivery_update"
  | "uploaded_file"
  | "unknown";
export type ProjectKnowledgeSourceType =
  | InferredKnowledgeSourceType
  | "manual"
  | "zoom_transcript"
  | "figma"
  | "clickup"
  | "clickup_doc"
  | "slack"
  | "agent"
  | "company_website"
  | "company_website_page"
  | "other"
  | "auto";

export type AgentRunStatus =
  | "pending"
  | "running"
  | "needs_confirmation"
  | "needs_clarification"
  | "confirmed"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentToolRunStatus =
  | "pending"
  | "needs_confirmation"
  | "confirmed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type ProjectPmAttentionStatus = "open" | "answered" | "skipped" | "cleared" | "resolved";
export type ProjectPmAttentionImportance = "low" | "medium" | "high";
export type ProjectKnowledgeInputMethod = "text" | "file" | "api";
export type AiProjectBriefStatus = "pending" | "completed" | "failed";
export type AiProposedTaskPriority = "low" | "medium" | "high" | "urgent";
export type AiProposedTaskStatus = "pending" | "accepted" | "rejected";
export type ClickupSyncStatus = "not_synced" | "syncing" | "synced" | "error";
export type ClickupLinkStatus = "active" | "disabled" | "error";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskSourceType = "manual" | "ai_proposed_task" | "figma" | "clickup" | "slack" | "other";
export type ProjectAiStatusReportType = "manual" | "daily" | "weekly" | "after_clickup_sync";
export type ProjectAiStatusReportStatus = "pending" | "completed" | "failed";
export type ProjectPmActionCategory =
  | "client_question"
  | "developer_followup"
  | "access_needed"
  | "scope_clarification"
  | "risk_review"
  | "qa_followup"
  | "general";
export type ProjectPmActionStatus = "open" | "in_progress" | "done" | "dismissed";
export type ProjectPmActionSource = "manual" | "ai_status_report" | "clickup_timeline" | "slack";
export type ProjectPmActionType =
  | "manual"
  | "create_clickup_task"
  | "assign_clickup_tasks"
  | "update_clickup_deadline"
  | "add_clickup_comment"
  | "request_access"
  | "ask_client_question"
  | "review_risk"
  | "review_scope";
export type ProjectPmExecutionStatus =
  | "not_started"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";
export type ProjectPmActionExecutionStatus = "succeeded" | "failed" | "partial";

export interface ProjectPmActionPayload {
  clickup_task_ids?: string[];
  ai_proposed_task_ids?: string[];
  suggested_clickup_task?: boolean;
  suggested_action_type?: "create_clickup_task" | "manual" | "ask_client_question";
  action_family?: string;
  signal_type?: string;
  suggested_assignee_role?: string;
  suggested_comment?: string;
  suggested_due_date?: string;
  question_text?: string;
  system_name?: string;
  comment_text?: string;
  blocker_kind?: string;
  source?: "slack" | "clickup" | "ai_status_report";
  slack_event_ids?: string[];
  slack_channel_id?: string;
  slack_thread_ts?: string;
  link_type?: "internal" | "external" | "other";
}

export type SlackWorkspaceStatus = "active" | "revoked" | "error";
export type ProjectSlackLinkType = "internal" | "external" | "other";
export type ProjectSlackLinkStatus = "active" | "disabled" | "error";

export interface SlackWorkspace {
  id: string;
  slack_team_id: string;
  slack_team_name: string | null;
  bot_user_id: string | null;
  installing_user_id: string | null;
  status: SlackWorkspaceStatus;
  scopes: string[];
  metadata: Json;
  connected_at: string;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSlackLink {
  id: string;
  project_id: string;
  slack_team_id: string;
  slack_channel_id: string;
  channel_name: string | null;
  channel_type: string | null;
  is_private: boolean;
  is_shared: boolean;
  is_ext_shared: boolean;
  link_label: string | null;
  link_type: ProjectSlackLinkType;
  purpose: string | null;
  include_in_ai: boolean;
  include_in_client_updates: boolean;
  is_client_facing: boolean;
  status: ProjectSlackLinkStatus;
  last_synced_at: string | null;
  last_event_ts: string | null;
  last_processed_ts: string | null;
  ingest_from_ts: string | null;
  ignore_history_before_ts: string | null;
  sync_mode: string | null;
  last_error: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SlackSignalType =
  | "blocker"
  | "access_needed"
  | "client_question"
  | "decision"
  | "scope_change"
  | "progress_update"
  | "meeting_needed"
  | "resolved"
  | "noise";

export type ProjectSignalStatus = "new" | "processing" | "processed" | "ignored";
export type ProjectSignalThreadState = "open" | "resolved" | "ignored" | "unclear";
export type AiProcessingJobStatus = "queued" | "running" | "completed" | "failed";

export interface ProjectSignal {
  id: string;
  project_id: string;
  source_type: "slack" | "clickup" | "manual" | "other";
  source_table: string | null;
  source_id: string | null;
  external_id: string;
  actor_name: string | null;
  source_created_at: string | null;
  title: string;
  summary: string | null;
  body: string | null;
  signal_type: string;
  priority: AiProposedTaskPriority;
  confidence: number | null;
  thread_key: string;
  action_key: string | null;
  signal_status: ProjectSignalStatus;
  is_client_facing: boolean;
  include_in_ai: boolean;
  include_in_client_updates: boolean;
  metadata: Json;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSignalThread {
  id: string;
  project_id: string;
  thread_key: string;
  source_type: "slack" | "clickup" | "manual" | "other";
  current_state: ProjectSignalThreadState;
  primary_signal_type: string | null;
  latest_signal_id: string | null;
  latest_signal_at: string | null;
  signal_count: number;
  summary: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface AiProcessingJob {
  id: string;
  project_id: string;
  job_type: "analyze_project_signals";
  status: AiProcessingJobStatus;
  priority: AiProposedTaskPriority;
  payload: Json;
  result: Json | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SlackSyncDebugMessagePreview = {
  text: string;
  signal_type: string;
  priority: string;
  thread_key: string;
  include_in_ai: boolean;
};

export type ReprocessSlackEventsResult = {
  events_checked: number;
  signals_upserted: number;
  meaningful_signals: number;
  noise_signals: number;
  threads_upserted: number;
  jobs_queued: number;
  actions_created?: number;
  actions_updated?: number;
  actions_auto_resolved?: number;
  timeline_events_created?: number;
  timeline_events_updated?: number;
  threads_checked?: number;
  duplicates_avoided?: number;
  previews: Array<{
    text: string;
    signal_type: string;
    priority: string;
    confidence: number;
    thread_key: string;
    action_key?: string;
    skipped_reason?: string;
  }>;
  warnings: string[];
};

export type SlackSyncProjectChannelResult = {
  imported_count: number;
  thread_replies_imported_count: number;
  skipped_count: number;
  events_upserted_count: number;
  signals_upserted_count: number;
  meaningful_signals_count: number;
  signal_threads_upserted_count: number;
  jobs_queued_count: number;
  latest_messages_preview: SlackSyncDebugMessagePreview[];
  warnings: string[];
  reprocessed?: boolean;
};

export type ProcessAiJobsResult = {
  processed_count: number;
  failed_count: number;
  actions_created_count: number;
  actions_updated_count?: number;
  actions_auto_resolved_count?: number;
  actions_skipped_count: number;
  actions_suppressed_count?: number;
  timeline_events_created_count?: number;
  timeline_events_updated_count?: number;
  threads_checked?: number;
  duplicates_avoided?: number;
  noise_skipped_count?: number;
  signals_checked?: number;
  signals_new?: number;
  signals_already_processed?: number;
  reasons: string[];
  job_ids: string[];
  suppression_reasons?: SuppressionReasonEntry[];
};

export type SuppressionReasonEntry = {
  action_key: string | null;
  reason: string;
  dismissed_action_id: string;
  thread_key?: string | null;
  title?: string | null;
  dismissed_at?: string | null;
  signal_type?: string | null;
};

export type SlackPipelineDiagnostics = {
  slackEventsCount: number;
  meaningfulSlackEventsCount: number;
  projectSignalsCount: number;
  openSignalThreadsCount: number;
  queuedOrRunningJobsCount: number;
  latestJob: AiProcessingJob | null;
  latestSlackPmAction: ProjectPmActionItem | null;
  hints: string[];
  recentSlackEvents: ProjectSlackEvent[];
  recentSignals: ProjectSignal[];
  recentThreads: ProjectSignalThread[];
  recentJobs: AiProcessingJob[];
};

export interface ProjectSlackEvent {
  id: string;
  project_id: string | null;
  project_slack_link_id: string | null;
  slack_team_id: string;
  slack_channel_id: string;
  slack_user_id: string | null;
  slack_user_name: string | null;
  slack_ts: string;
  slack_thread_ts: string | null;
  event_type: string;
  message_text: string | null;
  message_preview: string | null;
  is_thread_reply: boolean;
  is_bot_message: boolean;
  link_type: ProjectSlackLinkType | null;
  is_client_facing: boolean;
  include_in_ai: boolean;
  include_in_client_updates: boolean;
  raw_payload: Json;
  dedupe_key: string | null;
  signal_type: SlackSignalType | null;
  signal_confidence: number | null;
  processed_at: string | null;
  created_at: string;
}

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
  company_type: CompanyType;
  logo_url: string | null;
  description: string | null;
  status: string;
  billing_email: string | null;
  billing_address: Json;
  metadata: Json;
  created_at: string;
  updated_at: string;
  legal_name?: string | null;
  primary_domain?: string | null;
  alternate_domains?: string[];
  sub_industry?: string | null;
  headquarters?: string | null;
  country?: string | null;
  city?: string | null;
  company_size?: string | null;
  business_model?: string | null;
  products_services?: string | null;
  target_customers?: string | null;
  relationship_owner_id?: string | null;
  source?: string | null;
  first_interaction_at?: string | null;
  last_interaction_at?: string | null;
  next_meeting_at?: string | null;
  interaction_count?: number;
  relationship_strength?: string | null;
  tags?: string[];
  field_provenance?: Json;
  locked_fields?: string[];
  enrichment_status?: string;
  enrichment_confidence?: number | null;
  last_enriched_at?: string | null;
  enrichment_sources?: Json;
  needs_review?: boolean;
  archived_at?: string | null;
  display_name?: string | null;
  normalized_name?: string | null;
  name_confidence?: number | null;
  name_source?: string | null;
  manually_confirmed?: boolean;
  registrable_domain?: string | null;
  host_subdomain?: string | null;
  normalized_host?: string | null;
  data_quality_status?: string;
  suppressed_at?: string | null;
  classification_confidence?: number | null;
  classification_evidence?: Json;
  import_confidence?: number | null;
  import_confidence_band?: string | null;
  last_interaction_type?: string | null;
  last_interaction_direction?: string | null;
  primary_contact_id?: string | null;
  logo_storage_path?: string | null;
  logo_source?: string | null;
  logo_source_url?: string | null;
  logo_confidence?: number | null;
  logo_width?: number | null;
  logo_height?: number | null;
  logo_content_hash?: string | null;
  logo_resolved_at?: string | null;
  logo_status?: string;
  manual_logo_locked?: boolean;
  visibility_state?: string | null;
  quality_reason?: string | null;
  aggregated_sources?: string[];
  two_way_thread_count?: number;
  soft_deleted_at?: string | null;
  merged_into_id?: string | null;
}

/** Alias for Client — same underlying `clients` table. */
export type Company = Client;

export interface CompanyPerson {
  id: string;
  company_id: string;
  person_id: string;
  relationship_type: CompanyPersonRelationship;
  is_primary: boolean;
  notes: string | null;
  metadata: Json;
  created_at: string;
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
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  person_status: string;
  deactivated_at: string | null;
  metadata: Json;
  profile_id: string | null;
  // Contractor / team fields (used when type === "contractor")
  job_title: string | null;
  hourly_rate: number | null;
  availability: string | null;
  location: string | null;
  employment_type: string | null;
  stack: string[];
  created_at: string;
  updated_at: string;
  alternate_emails?: string[];
  timezone?: string | null;
  language?: string | null;
  department?: string | null;
  seniority?: string | null;
  relationship_type?: string | null;
  relationship_owner_id?: string | null;
  first_interaction_at?: string | null;
  next_meeting_at?: string | null;
  email_thread_count?: number;
  meeting_count?: number;
  tags?: string[];
  field_provenance?: Json;
  locked_fields?: string[];
  decision_maker?: boolean;
  technical_contact?: boolean;
  billing_contact?: boolean;
  archived_at?: string | null;
  display_name?: string | null;
  name_confidence?: number | null;
  name_source?: string | null;
  manually_confirmed?: boolean;
  is_role_inbox?: boolean;
  role_inbox_label?: string | null;
  data_quality_status?: string;
  suppressed_at?: string | null;
  import_confidence?: number | null;
  import_confidence_band?: string | null;
  last_interaction_at?: string | null;
  last_interaction_type?: string | null;
  last_interaction_direction?: string | null;
  interaction_count?: number;
  visibility_state?: string | null;
  quality_reason?: string | null;
  aggregated_sources?: string[];
  is_automated_sender?: boolean;
  two_way_thread_count?: number;
  soft_deleted_at?: string | null;
  merged_into_id?: string | null;
  lifecycle_stage?: string | null;
  primary_project_id?: string | null;
  identity_confidence?: number | null;
  primary_email?: string | null;
}

/** Alias for Contact — same underlying `contacts` table. */
export type Person = Contact;

export interface GoogleConnectionSafe {
  id: string;
  user_id: string;
  google_account_id: string;
  google_email: string;
  granted_scopes: string[];
  token_expires_at: string | null;
  status: string;
  sources_enabled: Record<string, boolean>;
  import_settings: Record<string, unknown>;
  connected_at: string;
  disconnected_at: string | null;
  last_successful_sync_at: string | null;
  last_sync_error: string | null;
  contacts_last_synced_at?: string | null;
  calendar_last_synced_at?: string | null;
  gmail_last_synced_at?: string | null;
  sync_incident_dismissed_at?: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface GoogleImportRun {
  id: string;
  connection_id: string;
  owner_user_id: string;
  run_type: string;
  status: string;
  progress_stage: string | null;
  sources: string[];
  lookback_months: number;
  settings: Json;
  counts: Json;
  trigger_run_id: string | null;
  progress_processed: number | null;
  progress_total: number | null;
  progress_percentage: number | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error: string | null;
  error_code: string | null;
  correlation_id: string | null;
  warnings: string[];
  created_at: string;
  updated_at: string;
  enrichment_status?: string | null;
  core_sync_status?: string | null;
  enrichment_paused_at?: string | null;
  processor_version?: number | null;
  workflow_version?: number | null;
  source_progress?: Json;
  last_heartbeat_at?: string | null;
  sync_mode?: string | null;
  cost_metrics?: Json;
  recovered_at?: string | null;
  resumed_at?: string | null;
  resumed_from_trigger_run_id?: string | null;
  last_historical_error_code?: string | null;
  last_historical_error_message?: string | null;
  import_history?: Json;
  action_required?: boolean | null;
  recovery_status?: string | null;
  next_retry_at?: string | null;
  retry_count?: number | null;
  retry_task_run_id?: string | null;
  finalization_started_at?: string | null;
  finalization_heartbeat_at?: string | null;
  last_reconciled_at?: string | null;
  last_reconciliation_outcome?: string | null;
}

export type GoogleSyncStage =
  | "idle"
  | "queued"
  | "syncing_contacts"
  | "syncing_calendar"
  | "syncing_gmail"
  | "resolving_entities"
  | "processing_relationships"
  | "enriching_companies"
  | "finalizing"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export interface CrmEntityCandidate {
  id: string;
  owner_user_id: string;
  connection_id: string | null;
  entity_type: "company" | "person" | "lead";
  status: string;
  display_name: string;
  email: string | null;
  domain: string | null;
  website: string | null;
  job_title: string | null;
  company_name: string | null;
  suggested_company_type: string | null;
  suggested_relationship_type: string | null;
  confidence: number;
  evidence: Json;
  sources: string[];
  reason: string | null;
  model_version: string | null;
  matched_company_id: string | null;
  matched_person_id: string | null;
  created_entity_id: string | null;
  processed_at: string | null;
  processed_by: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface GoogleInteraction {
  id: string;
  connection_id: string;
  owner_user_id: string;
  provider: string;
  interaction_type: string;
  external_id: string;
  external_thread_id: string | null;
  occurred_at: string;
  subject: string | null;
  participant_emails: string[];
  participant_names: string[];
  organizer_email: string | null;
  attendee_emails: string[];
  direction: string | null;
  snippet: string | null;
  ai_summary: string | null;
  classification: string | null;
  importance: string | null;
  company_id: string | null;
  person_ids: string[];
  project_id: string | null;
  metadata: Json;
  processed_at: string | null;
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

export type ProfileRole = "super_admin" | "pm";

export type ProfileAccessStatus = "active" | "pending" | "blocked";

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: ProfileRole;
  access_status: ProfileAccessStatus;
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
  company_website_url: string | null;
  request_message: string | null;
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
  image_path: string | null;
  company_website_url: string | null;
  company_logo_url: string | null;
  company_enriched_name: string | null;
  company_enriched_description: string | null;
  company_industry: string | null;
  company_positioning: string | null;
  company_product_type: string | null;
  company_target_users: string[];
  company_key_features: string[];
  company_enrichment_status: CompanyEnrichmentStatus;
  company_enrichment_error: string | null;
  company_enriched_at: string | null;
  company_enrichment_metadata: Json;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type CompanyEnrichmentStatus = "not_started" | "queued" | "running" | "succeeded" | "failed";

export interface ProjectWithAssignees extends Project {
  /** @deprecated Legacy app-user assignees; prefer team_contacts. */
  assignees: Profile[];
  team_contacts: Contact[];
  owner: Profile | null;
  /** Client organization logo from joined `clients` row (organization or client). */
  client_logo_url?: string | null;
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
  implementation_notes: string[];
  design_notes: string[];
  estimate_hours: number | null;
  source_knowledge_source_id: string | null;
  figma_file_key: string | null;
  figma_node_ids: string[];
  design_url: string | null;
  clickup_task_id: string | null;
  clickup_task_url: string | null;
  clickup_sync_status: ClickupSyncStatus;
  clickup_synced_at: string | null;
  clickup_sync_error: string | null;
  selected_clickup_assignee_ids: string[];
  selected_due_date: string | null;
  selected_due_date_time: boolean;
  clickup_creation_options: Json;
  raw_item: Json | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectPmProfile {
  id: string;
  project_id: string;
  business_goal: string | null;
  target_users: string[];
  core_flows: string[];
  scope_in: string[];
  scope_out: string[];
  success_criteria: string[];
  assumptions: string[];
  constraints: string[];
  risks: string[];
  open_questions: string[];
  qa_strategy: string | null;
  technical_notes: string[];
  delivery_notes: string[];
  current_phase: string | null;
  confidence: number | null;
  last_source_id: string | null;
  last_ai_brief_id: string | null;
  raw_profile: Json | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectPmAttentionItem {
  id: string;
  project_id: string;
  question: string;
  reason: string | null;
  importance: ProjectPmAttentionImportance;
  blocks_task_creation: boolean;
  status: ProjectPmAttentionStatus;
  source_memory_run_id: string | null;
  source_knowledge_source_id: string | null;
  answer_text: string | null;
  question_key: string | null;
  created_by: string | null;
  created_at: string;
  answered_at: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_summary: string | null;
  resolution_evidence: string | null;
  resolution_source_ids: string[] | null;
  updated_at: string | null;
  metadata: Json;
}

export interface ProjectKnowledgeSource {
  id: string;
  project_id: string | null;
  source_type: ProjectKnowledgeSourceType;
  source_title: string | null;
  input_method: ProjectKnowledgeInputMethod;
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  char_count: number | null;
  source_text: string | null;
  source_preview: string | null;
  external_provider: string | null;
  external_id: string | null;
  sync_status?: KnowledgeSyncStatus | null;
  last_synced_at?: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
}

export type KnowledgeSyncStatus = "active" | "out_of_scope" | "unknown_scope" | "archived" | "deleted";

export interface ProjectKnowledgeChunk {
  id: string;
  project_id: string | null;
  source_id: string | null;
  chunk_index: number;
  content: string;
  summary: string | null;
  category: string | null;
  metadata: Json;
  embedding_model: string | null;
  embedded_at: string | null;
  created_at: string;
}

export interface ClickupDocSyncResult {
  docs_checked?: number;
  docs_imported?: number;
  docs_updated?: number;
  docs_skipped_unchanged?: number;
  docs_skipped_out_of_scope?: number;
  docs_marked_out_of_scope?: number;
  docs_unknown_scope?: number;
  active_clickup_docs?: number;
  out_of_scope_clickup_docs?: number;
  unknown_scope_clickup_docs?: number;
  chunks_created?: number;
  chunks_updated?: number;
  chunks_deleted_or_replaced?: number;
  memory_update_queued?: boolean;
  embedding_queued?: boolean;
  embedding_enabled?: boolean;
  retrieval_mode?: "vector" | "fallback";
  trigger_run_ids?: string[];
  warnings?: string[];
  scope_parent?: string;
  scope_mode?: string;
  message?: string;
  trigger_run_id?: string;
  async?: boolean;
  synced_count?: number;
  trigger_environment?: string;
  fallback_used?: boolean;
  warning?: string;
}

export interface ProjectAgentRun {
  id: string;
  project_id: string;
  user_id: string | null;
  input_summary: string | null;
  detected_intent: string | null;
  status: AgentRunStatus;
  result_summary: string | null;
  clarification_questions: Json;
  tool_run_ids: string[];
  created_source_ids: string[];
  created_task_ids: string[];
  created_doc_ids: string[];
  trigger_run_id: string | null;
  raw_response: Json | null;
  diagnostics: Json;
  created_at: string;
  completed_at: string | null;
}

export interface AgentToolRun {
  id: string;
  project_id: string;
  user_id: string | null;
  agent_run_id: string | null;
  tool_name: string;
  status: AgentToolRunStatus;
  requires_confirmation: boolean;
  confirmed_at: string | null;
  trigger_run_id: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  step_key?: string | null;
  step_order?: number | null;
  depends_on?: string[] | null;
  input_payload: Json;
  result_payload: Json | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export type ProjectAgentRunResult = {
  agent_run_id: string;
  status: AgentRunStatus;
  result_summary?: string;
  answer?: string | null;
  clarification_questions?: Array<{
    question: string;
    reason?: string;
    importance?: string;
  }>;
  tool_run_ids?: string[];
  created_task_ids?: string[];
  created_source_ids?: string[];
  trigger_run_id?: string | null;
  trigger_enabled?: boolean;
  fallback_used?: boolean;
  warning?: string;
  async?: boolean;
  confidence?: number;
  diagnostics?: {
    model?: string;
    retrieval_mode?: "vector" | "fallback";
    chunks_retrieved_count?: number;
    langfuse_trace_id?: string;
    langfuse_generation_id?: string;
    langfuse_trace_url?: string;
    langfuse_enabled?: boolean;
    langfuse_error?: string;
    clickup_hierarchy_last_synced?: string | null;
    clickup_folders_known?: number;
    clickup_lists_known?: number;
    clickup_docs_known?: number;
    clickup_doc_chunks_retrieved?: number;
    active_clickup_doc_sources?: number;
    excluded_out_of_scope_sources?: number;
    embeddings_enabled?: boolean;
    embedding_provider?: string;
    embedding_skip_reason?: string;
    trigger_configured?: boolean;
    trigger_enabled?: boolean;
    trigger_run_id?: string;
    fallback_used?: boolean;
    runtime?: string;
    tool_calls_planned_count?: number;
    pending_tool_runs_count?: number;
    workflow_step_count?: number;
    clickup_connected?: boolean;
    total_tool_calls_planned?: number;
    safe_tool_calls_planned?: number;
    external_mutation_tool_calls_planned?: number;
    confirmation_required_tool_calls_planned?: number;
    tool_calls_created?: number;
    tool_calls_rejected?: number;
    rejected_tool_call_reasons?: Array<{ tool_name: string; reason: string }>;
    tool_validation_errors?: Array<{ tool_name: string; reason: string }>;
    proposed_tasks_created_count?: number;
    attention_reconciliation_ran?: boolean;
    attention_open_before?: number;
    attention_resolved_count?: number;
    attention_updated_count?: number;
    attention_kept_open_count?: number;
    attention_new_questions_count?: number;
    attention_resolved_item_ids?: string[];
    warnings?: string[];
  };
};

export interface ProjectFigmaReference {
  id: string;
  project_id: string;
  figma_url: string;
  file_key: string;
  node_id: string | null;
  title: string | null;
  description: string | null;
  last_imported_at: string | null;
  last_error: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClickupMember {
  id: string;
  clickup_team_id: string;
  clickup_user_id: string;
  username: string | null;
  email: string | null;
  initials: string | null;
  profile_picture: string | null;
  role: string | null;
  is_active: boolean;
  raw_member: Json;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectClickupAssignableMember {
  id: string;
  project_id: string;
  clickup_user_id: string;
  team_id: string | null;
  space_id: string | null;
  folder_id: string | null;
  list_id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  is_assignable: boolean;
  reason: string | null;
  metadata: Json;
  last_synced_at: string;
  created_at: string;
}

export type ClickupAssignableMembersSyncDiagnostics = {
  workspace_member_count: number;
  assignable_member_count: number;
  hidden_workspace_member_count: number;
  sync_source: string;
  confidence?: string;
  linked_space_id?: string | null;
  linked_space_name?: string | null;
  linked_folder_id?: string | null;
  linked_folder_name?: string | null;
  linked_list_id?: string | null;
  linked_list_name?: string | null;
  last_synced_at?: string;
};

export type ClickupAuthorizedTeam = {
  id: string;
  name: string;
  color?: string | null;
};

export interface UserClickupConnection {
  status: "active" | "revoked" | "error";
  clickup_user_id: string | null;
  clickup_username: string | null;
  clickup_email: string | null;
  authorized_teams: ClickupAuthorizedTeam[];
  selected_team_id: string | null;
  selected_team_name: string | null;
  connected_at: string;
  last_verified_at: string | null;
  last_error: string | null;
}

export type ClickupMyConnectionResponse = {
  connected: boolean;
  connection: UserClickupConnection | null;
};

export interface ProjectClickupLink {
  id: string;
  project_id: string;
  clickup_team_id: string;
  clickup_space_id: string | null;
  clickup_folder_id: string | null;
  clickup_list_id: string | null;
  clickup_webhook_id: string | null;
  space_name: string | null;
  folder_name: string | null;
  list_name: string | null;
  space_url: string | null;
  list_url: string | null;
  status: ClickupLinkStatus;
  last_sync_at: string | null;
  last_error: string | null;
  clickup_template_version: number | null;
  clickup_setup_status: string | null;
  clickup_setup_audited_at: string | null;
  clickup_setup_updated_at: string | null;
  clickup_setup_snapshot: Json | null;
  clickup_setup_warnings: Json | null;
  clickup_setup_error: string | null;
  clickup_setup_updated_by: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClickupTaskLink {
  id: string;
  project_id: string;
  ai_proposed_task_id: string | null;
  pm_action_item_id: string | null;
  clickup_team_id: string;
  clickup_space_id: string | null;
  clickup_folder_id: string | null;
  clickup_list_id: string;
  clickup_task_id: string;
  clickup_task_url: string | null;
  clickup_task_name: string | null;
  clickup_status: string | null;
  clickup_priority: string | null;
  last_snapshot: Json | null;
  last_synced_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectClickupTimelineEvent {
  id: string;
  project_id: string;
  clickup_task_link_id: string | null;
  clickup_task_id: string | null;
  clickup_comment_id: string | null;
  clickup_parent_comment_id: string | null;
  clickup_thread_id: string | null;
  comment_text: string | null;
  event_type: string;
  event_title: string;
  event_summary: string | null;
  actor_name: string | null;
  actor_email: string | null;
  clickup_date: string | null;
  direction: "to_clickup" | "from_clickup";
  source: "webhook" | "manual_sync" | "oxus_action";
  raw_payload: Json;
  dedupe_key: string | null;
  created_at: string;
}

export type ProjectTimelineSourceType =
  | "slack"
  | "clickup"
  | "pm_action"
  | "zoom"
  | "figma"
  | "github"
  | "manual"
  | "ai"
  | "other"
  | "company_website"
  | "system"
  | "pandadoc";

export interface ProjectTimelineEvent {
  id: string;
  project_id: string;
  source_type: ProjectTimelineSourceType;
  source_table: string | null;
  source_id: string | null;
  external_id: string | null;
  event_type: string;
  event_title: string;
  event_summary: string | null;
  event_body: string | null;
  actor_name: string | null;
  actor_email: string | null;
  source_created_at: string | null;
  priority: AiProposedTaskPriority;
  visibility: "internal" | "external" | "client_safe";
  signal_type: string | null;
  thread_key: string | null;
  action_key: string | null;
  related_pm_action_item_id: string | null;
  related_clickup_task_id: string | null;
  related_slack_channel_id: string | null;
  source_url: string | null;
  metadata: Json;
  created_at: string;
}

export type ProjectTimelineFilters = {
  sourceType?: ProjectTimelineSourceType | "all";
  signalType?: string | "all";
};

export interface ProjectAiStatusReport {
  id: string;
  project_id: string;
  report_type: ProjectAiStatusReportType;
  period_start: string | null;
  period_end: string | null;
  summary: string | null;
  what_changed: string[];
  blockers: string[];
  risks: string[];
  open_questions: string[];
  pm_actions: string[];
  client_updates: string[];
  scope_changes: string[];
  health_recommendation: ProjectHealth | null;
  risk_recommendation: RiskLevel | null;
  confidence: number | null;
  source_event_ids: string[];
  raw_response: Json | null;
  model: string | null;
  status: ProjectAiStatusReportStatus;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectPmActionItem {
  id: string;
  project_id: string;
  status_report_id: string | null;
  title: string;
  description: string | null;
  category: ProjectPmActionCategory;
  priority: AiProposedTaskPriority;
  status: ProjectPmActionStatus;
  due_date: string | null;
  source: ProjectPmActionSource;
  source_event_ids: string[];
  action_type: ProjectPmActionType;
  action_payload: ProjectPmActionPayload;
  execution_status: ProjectPmExecutionStatus;
  execution_result: Json | null;
  execution_error: string | null;
  executed_at: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  action_key: string | null;
  blocker_type: string | null;
  blocker_resource: string | null;
  blocked_actor_name: string | null;
  blocked_actor_email: string | null;
  related_clickup_task_ids: string[];
  related_clickup_task_titles: string[];
  signal_count: number;
  first_signal_at: string | null;
  latest_signal_at: string | null;
  last_signal_summary: string | null;
  resolution_note: string | null;
  resolution_source: "manual" | "clickup_signal" | "slack_signal" | "ai" | "dedupe" | "dismissed" | null;
  auto_resolved_by_event_id: string | null;
  auto_resolved_reason: string | null;
  action_identity?: string | null;
  source_signal_ids?: string[];
  source_external_id?: string | null;
  last_dedupe_check_at?: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  dismiss_reason: string | null;
  suppressed_signal_count: number;
  latest_suppressed_at: string | null;
  suppression_expires_at: string | null;
  source_type: "slack" | "clickup" | "zoom" | "figma" | "github" | "manual" | "ai" | "other" | null;
  source_app: string | null;
  source_label: string | null;
  source_actor_name: string | null;
  source_actor_email: string | null;
  source_message: string | null;
  source_message_ts: string | null;
  source_url: string | null;
  source_thread_key: string | null;
  source_metadata: Json;
  change_history: Json;
  clickup_task_id: string | null;
  clickup_task_url: string | null;
  clickup_sync_status: "not_synced" | "syncing" | "synced" | "error";
  clickup_synced_at: string | null;
  clickup_sync_error: string | null;
  selected_clickup_assignee_ids: string[];
  selected_due_date: string | null;
  selected_due_date_time: boolean;
  suggested_task_title: string | null;
  suggested_task_description: string | null;
  suggested_assignee_names: string[];
  suggested_clickup_assignee_ids: string[];
  suggested_due_date: string | null;
  suggested_due_date_text: string | null;
  suggested_priority: AiProposedTaskPriority | null;
  task_draft_metadata: Json;
}

export interface ProjectPmActionExecution {
  id: string;
  project_id: string;
  action_item_id: string | null;
  action_type: ProjectPmActionType;
  input_payload: Json;
  result_payload: Json;
  status: ProjectPmActionExecutionStatus;
  error_message: string | null;
  clickup_task_ids: string[];
  created_by: string | null;
  created_at: string;
}

export interface PmOpenActionItem extends ProjectPmActionItem {
  project_name: string;
}

export interface PmProjectAttention {
  project_id: string;
  project_name: string;
  health: ProjectHealth;
  risk: RiskLevel;
  status: ProjectStatus;
  open_action_count: number;
  urgent_action_count: number;
  high_action_count: number;
  client_question_count: number;
  latest_action_at: string | null;
  latest_clickup_event_at: string | null;
  needs_ai_review: boolean;
  last_status_report_at: string | null;
}

export interface PmRecentClickupActivity extends ProjectClickupTimelineEvent {
  project_name: string;
  task_name: string | null;
}

export interface PmStaleClickupTask {
  project_id: string;
  project_name: string;
  clickup_task_id: string;
  task_name: string | null;
  task_url: string | null;
  status: string | null;
  due_date: string | null;
  last_synced_at: string | null;
  days_quiet: number;
}

export interface PmDailyPlanProjectFocus {
  project_id: string;
  project_name: string;
  reason: string;
  recommended_action: string;
  urgency: AiProposedTaskPriority;
}

export interface PmDailyPlan {
  id: string;
  plan_date: string;
  summary: string | null;
  top_priorities: string[];
  project_focus: PmDailyPlanProjectFocus[];
  risks: string[];
  suggested_order: string[];
  raw_response: Json | null;
  model: string | null;
  created_by: string | null;
  created_at: string;
}

export type NewAiProjectBrief = {
  project_id: string;
  source_type?: ProjectKnowledgeSourceType;
  source_text?: string;
  input_text?: string;
  source_title?: string | null;
  input_method?: ProjectKnowledgeInputMethod;
  file_name?: string | null;
  mime_type?: string | null;
  metadata?: Record<string, unknown>;
};

export type MemoryProcessingResult = {
  source: ProjectKnowledgeSource;
  profile: ProjectPmProfile;
  brief: AiProjectBrief;
  tasks: AiProposedTask[];
  attention_items?: ProjectPmAttentionItem[];
  detected_source_type?: InferredKnowledgeSourceType;
  summary?: string;
  confidence?: number;
};

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
  description: string | null;
  priority: TaskPriority;
  acceptance_criteria: string[];
  qa_scenarios: AiQaScenario[];
  implementation_notes: string[];
  design_notes: string[];
  estimate_hours: number | null;
  source_type: TaskSourceType | null;
  source_ai_proposed_task_id: string | null;
  source_ai_brief_id: string | null;
  source_knowledge_source_id: string | null;
  figma_file_key: string | null;
  figma_node_ids: string[];
  design_url: string | null;
  external_provider: string | null;
  external_id: string | null;
  external_url: string | null;
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
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
  provider: DocumentProvider;
  external_id: string | null;
  external_url: string | null;
  status: string | null;
  title: string | null;
  metadata: Json;
  last_synced_at: string | null;
  superseded_at: string | null;
  superseded_by_id: string | null;
}

export type DocumentProvider = "upload" | "pandadoc";

export type ProjectDocumentSlotType = "msa" | "nda" | "active_sow" | "other";

export type NormalizedPandaDocDocument = {
  external_id: string;
  name: string;
  status: string;
  date_created?: string;
  date_modified?: string;
  date_sent?: string;
  date_completed?: string;
  owner_name?: string;
  recipients?: Array<{
    name?: string;
    email?: string;
    role?: string;
  }>;
  folder_id?: string;
  external_url?: string;
  metadata: Record<string, unknown>;
};

export interface PandaDocConnectionStatus {
  configured: boolean;
  connected: boolean;
  workspace_name: string | null;
  last_successful_sync_at: string | null;
  last_sync_error: string | null;
  webhook_configured?: boolean;
  webhook_last_received_at: string | null;
}

export interface LineItem {
  id: string;
  description: string;
  amount: number;
  quantity: number;
  unit_amount: number | null;
  line_total: number | null;
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
  amount_due: number;
  status: InvoiceStatus;
  issue_date: string;
  issued_at: string | null;
  due_date: string | null;
  due_at: string | null;
  paid_date: string | null;
  payment_method: string | null;
  owner_id: string | null;
  owner_name: string | null;
  last_reminder_at: string | null;
  stripe_status: string | null;
  provider: InvoiceProvider;
  external_id: string | null;
  external_customer_id: string | null;
  external_url: string | null;
  hosted_invoice_url: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_eur: number | null;
  amount_due_eur: number | null;
  amount_paid_eur: number | null;
  subtotal_eur: number | null;
  tax_amount_eur: number | null;
  fx_status: string | null;
  fx_rate_to_eur: number | null;
  fx_rate_date: string | null;
  sync_status: string;
  last_synced_at: string | null;
  company_mapping_status: string;
  attention_dismissed_at: string | null;
  attention_dismissed_by: string | null;
  attention_dismiss_reason: string | null;
  paid_at: string | null;
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
  provider?: "manual" | "google";
  external_id?: string | null;
  external_calendar_id?: string | null;
  organizer_email?: string | null;
  attendee_emails?: string[];
  meeting_url?: string | null;
  html_link?: string | null;
  ai_summary?: string | null;
  metadata?: Json;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventWithAttendees extends CalendarEvent {
  attendees: Profile[];
}

export interface ProjectExecutionNote {
  id: string;
  project_id: string;
  author_id: string | null;
  note_text: string;
  created_at: string;
  updated_at: string;
  author?: Profile | null;
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

export type ActivityVisibility = "team" | "admin_only";

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  contact_id: string | null;
  company_id?: string | null;
  interaction_type?: string | null;
  occurred_at?: string | null;
  source?: string | null;
  metadata?: Json;
  visibility?: ActivityVisibility;
  created_at: string;
}

export type TeamMemberRateStatus = "active" | "scheduled" | "expired";
export type TeamMemberRateMatchType =
  | "project_work_type"
  | "project"
  | "work_type"
  | "default"
  | "none";
export type SupportedCurrency = "EUR" | "USD";

export interface TeamMemberRateProject {
  id: string;
  name: string;
  archived_at?: string | null;
}

export interface TeamMemberRate {
  id: string;
  person_id: string;
  name: string | null;
  description: string | null;
  rate_type: RateType;
  amount: number;
  currency: SupportedCurrency | string;
  /** @deprecated Use project_ids — kept for backward compatibility during migration */
  project_id: string | null;
  project_ids: string[];
  projects: TeamMemberRateProject[];
  work_type: string | null;
  is_default: boolean;
  effective_from: string;
  effective_to: string | null;
  status: TeamMemberRateStatus;
  notes: string | null;
  created_at: string;
}

export interface TeamMemberRateConflict {
  project_id: string | null;
  project_name: string | null;
  conflicting_rate_id: string;
  conflicting_rate_name: string | null;
  effective_from: string;
  effective_to: string | null;
}

export interface TeamMemberRateConflictResult {
  conflicts: TeamMemberRateConflict[];
}

export interface ResolveTeamMemberRateResult {
  rate: TeamMemberRate | null;
  match_type: TeamMemberRateMatchType;
  alternatives: TeamMemberRate[];
  warning?: string;
}

export interface TeamMemberRateInput {
  person_id: string;
  name: string;
  description?: string | null;
  rate_type: RateType;
  amount: number;
  currency?: SupportedCurrency | string;
  /** @deprecated Use project_ids */
  project_id?: string | null;
  project_ids?: string[];
  work_type?: string | null;
  is_default?: boolean;
  effective_from: string;
  effective_to?: string | null;
  notes?: string | null;
}

export interface CurrencyBreakdownLine {
  currency: string;
  native_amount: number;
  amount_eur: number | null;
  fx_rate_to_eur: number | null;
  fx_rate_date: string | null;
  count: number;
}

export interface EurReportingAggregate {
  total_eur: number | null;
  breakdown: CurrencyBreakdownLine[];
  has_unconverted: boolean;
}

export interface Payout {
  id: string;
  person_id: string;
  project_id: string | null;
  amount: number;
  currency: string;
  amount_eur: number | null;
  fx_status: string | null;
  fx_rate_to_eur: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  rate_id: string | null;
  payment_date: string | null;
  period_start: string | null;
  period_end: string | null;
  provider: PayoutProvider;
  external_id: string | null;
  external_url: string | null;
  status: string;
  notes: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  expense_date: string;
  provider: string;
  external_id: string | null;
  project_id: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface StripeConnectionStatus {
  configured: boolean;
  connected: boolean;
  account: {
    id: string | null;
    business_name: string | null;
    country: string | null;
    default_currency: string | null;
    email: string | null;
  } | null;
  last_successful_sync_at: string | null;
  last_sync_error: string | null;
  webhook_configured?: boolean;
  webhook_last_received_at: string | null;
  webhook_last_processed_at?: string | null;
  webhook_last_event_id?: string | null;
  webhook_endpoint_url?: string | null;
  webhook_endpoint_reachable?: boolean | null;
  webhook_pending_events?: number;
  webhook_failed_events?: number;
  webhook_processing_events?: number;
  webhook_processed_events?: number;
}

export type StripeInvoiceActionType =
  | "finalize"
  | "send"
  | "mark_paid_out_of_band"
  | "void"
  | "mark_uncollectible"
  | "delete_draft";

export interface StripeSyncResult {
  checked: number;
  imported: number;
  updated: number;
  unchanged: number;
  companies_matched: number;
  companies_requiring_review: number;
  errors: string[];
  invoices_synced?: number;
  fx_needed?: number;
  fx_converted?: number;
  fx_cached?: number;
  fx_unavailable?: number;
  fx_remaining?: number;
  fx_batches?: number;
  metrics_currency?: "EUR";
  payments_checked?: number;
  payments_reconciled_actual?: number;
  payments_reconciled_reference?: number;
  payments_paid_out_of_band?: number;
  payments_unresolved?: number;
  gross_eur_minor?: number;
  stripe_fees_eur_minor?: number;
  net_eur_minor?: number;
  warnings?: string[];
}

export type PaymentReconciliationBasis =
  | "stripe_actual_settlement"
  | "native_eur"
  | "ecb_reference"
  | "paid_out_of_band_reference"
  | "unavailable";

export interface InvoicePaymentReconciliation {
  id: string;
  invoice_id: string;
  provider: string;
  external_invoice_payment_id: string | null;
  external_payment_intent_id: string | null;
  external_charge_id: string | null;
  external_balance_transaction_id: string | null;
  payment_type: string | null;
  paid_at: string;
  reporting_month: string;
  original_currency: string;
  original_amount_minor: number;
  settlement_currency: string | null;
  settlement_gross_minor: number | null;
  stripe_fee_minor: number | null;
  settlement_net_minor: number | null;
  stripe_exchange_rate: number | null;
  reference_rate_to_eur: number | null;
  reference_rate_date: string | null;
  reference_eur_minor: number | null;
  gross_eur_minor: number | null;
  stripe_fee_eur_minor: number | null;
  net_eur_minor: number | null;
  amount_basis: PaymentReconciliationBasis;
  is_paid_out_of_band: boolean;
  fee_details: Array<{ amount?: number; currency?: string; type?: string; description?: string | null }>;
  sync_status: string;
  sync_error: string | null;
  metadata: Record<string, unknown>;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
  invoices?: {
    number?: string;
    client_name?: string | null;
    external_id?: string | null;
    external_url?: string | null;
    hosted_invoice_url?: string | null;
  } | null;
}

export interface StripeReconcilePaymentsResult {
  payments_checked: number;
  payments_reconciled_actual: number;
  payments_reconciled_reference: number;
  payments_paid_out_of_band: number;
  payments_unresolved: number;
  gross_eur_minor: number;
  stripe_fees_eur_minor: number;
  net_eur_minor: number;
  warnings: string[];
  reporting_timezone?: string;
  metrics_currency?: "EUR";
}

export interface CompanyFinancialMetrics {
  lifetime_revenue: number;
  revenue_ytd: number;
  revenue_mtd: number;
  outstanding: number;
  overdue: number;
  active_projects: number;
  avg_project_value: number;
}

export type ContractorInvoiceStatus =
  | "received"
  | "approved"
  | "partially_paid"
  | "paid"
  | "disputed"
  | "cancelled";

export type ContractorInvoiceSource = "manual" | "uploaded_file" | "wise" | "email" | "other";

export interface ContractorInvoice {
  id: string;
  person_id: string;
  project_id: string | null;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  total_eur: number | null;
  fx_status: string | null;
  fx_rate_to_eur: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  status: ContractorInvoiceStatus;
  source: ContractorInvoiceSource;
  external_id: string | null;
  external_url: string | null;
  file_path: string | null;
  description: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_amount: number;
  paid_at: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  projects?: Pick<Project, "id" | "name"> | null;
}

export interface ContractorInvoicePayment {
  id: string;
  contractor_invoice_id: string;
  payout_id: string;
  allocated_amount: number;
  created_at: string;
  contractor_invoices?: Pick<ContractorInvoice, "id" | "invoice_number" | "total" | "currency"> | null;
}

export interface ContractorInvoiceSummary {
  outstanding: number;
  due_this_month: number;
  paid_ytd: number;
  invoice_count: number;
}

export interface PayoutWithAllocations extends Payout {
  contractor_invoice_payments?: ContractorInvoicePayment[];
}

export interface TeamMemberFinancialSummary {
  paid_mtd: number;
  paid_ytd: number;
  lifetime_paid: number;
  pending: number;
  last_payment_date: string | null;
  current_rate: TeamMemberRate | null;
  default_rate: TeamMemberRate | null;
  active_rate_count: number;
  paid_mtd_eur: EurReportingAggregate | null;
  paid_ytd_eur: EurReportingAggregate | null;
  outstanding_payables_eur: EurReportingAggregate | null;
  ready_to_pay_eur: EurReportingAggregate | null;
  /** @deprecated Use outstanding_payables_eur */
  outstanding_invoices_eur?: EurReportingAggregate | null;
  active_projects: number;
  active_project_names: string[];
  outstanding_payables?: number;
  ready_to_pay?: number;
  /** @deprecated Use outstanding_payables */
  outstanding_invoices?: number;
  available_capacity?: string | null;
}

export interface ProjectContactAssignment {
  project_id: string;
  contact_id: string;
  role_on_project: string | null;
  allocation_percent: number | null;
  weekly_hours: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  notes: string | null;
  rate_id: string | null;
  rate_snapshot_amount: number | null;
  rate_snapshot_currency: string | null;
  rate_snapshot_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
  projects?: Pick<Project, "id" | "name" | "status"> | null;
  team_member_rates?: TeamMemberRate | null;
}

export interface TeamRosterRow {
  person: Contact;
  current_rate: TeamMemberRate | null;
  active_projects: Pick<Project, "id" | "name">[];
  paid_mtd: number;
  paid_ytd: number;
  last_payment_date: string | null;
}

export interface TeamKpiSummary {
  active_team: number;
  available_capacity: number | null;
  fully_allocated: number | null;
  paid_this_month: number | null;
  outstanding_payables: number | null;
  ready_to_pay: number | null;
  /** @deprecated Use outstanding_payables */
  outstanding_invoices?: number | null;
  active_assignments: number;
  has_payout_data: boolean;
  has_capacity_data: boolean;
  has_payable_data: boolean;
  /** @deprecated Use has_payable_data */
  has_invoice_data?: boolean;
}

export interface TeamMemberDependencySummary {
  project_assignments: number;
  payouts: number;
  payout_total: number;
  contractor_invoices: number;
  rate_records: number;
  company_relationships: number;
  activities: number;
  deals: number;
  has_workspace_access: boolean;
  auth_user_id: string | null;
}

export interface TeamMemberDeleteCheck {
  person: {
    id: string;
    name: string;
    email: string | null;
    person_status: string;
  };
  can_delete: boolean;
  blockers: string[];
  summary: TeamMemberDependencySummary;
  will_delete: string[];
  will_preserve: string[];
}

export type TeamMemberPayableCalculationBasis =
  | "manual"
  | "hours_x_rate"
  | "days_x_rate"
  | "percentage_of_client_invoice"
  | "fixed_project";

export type TeamMemberPayableApprovalStatus = "draft" | "approved" | "cancelled";

export type TeamMemberPayableReleaseCondition = "immediate" | "when_client_invoice_paid" | "manual";

export type TeamMemberPayableUiState =
  | "draft"
  | "waiting_for_client_payment"
  | "waiting_for_release"
  | "ready_to_pay"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "needs_review";

export interface TeamMemberPayable {
  id: string;
  person_id: string;
  project_id: string | null;
  client_invoice_id: string | null;
  contractor_invoice_id: string | null;
  title: string | null;
  description: string | null;
  work_type: string | null;
  calculation_basis: TeamMemberPayableCalculationBasis;
  source_rate_id: string | null;
  quantity: number | null;
  unit_amount: number | null;
  unit_currency: string | null;
  percentage: number | null;
  currency: string;
  amount: number;
  amount_eur: number | null;
  fx_rate_to_eur: number | null;
  fx_rate_date: string | null;
  fx_rate_source: string | null;
  fx_status: string | null;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  approval_status: TeamMemberPayableApprovalStatus;
  release_condition: TeamMemberPayableReleaseCondition;
  released_at: string | null;
  needs_review: boolean;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
  contacts?: Pick<Contact, "id" | "name"> | null;
  projects?: Pick<Project, "id" | "name"> | null;
  invoices?: Pick<Invoice, "id" | "number" | "status" | "client_name" | "currency" | "total"> & { total_eur?: number | null } | null;
}

export interface TeamMemberPayablePayment {
  id: string;
  payable_id: string;
  payout_id: string;
  allocated_amount: number;
  allocated_amount_eur: number | null;
  created_at: string;
}

export interface TeamMemberPayableEnriched extends TeamMemberPayable {
  allocations?: { allocated_amount: number; allocated_amount_eur?: number | null }[];
  paid_amount: number;
  paid_amount_eur: number | null;
  remaining_amount: number;
  payment_status: "unpaid" | "partially_paid" | "paid";
  ui_state: TeamMemberPayableUiState;
}

export interface TeamPayablesSummary {
  period: string;
  payables: TeamMemberPayableEnriched[];
  summary: {
    outstanding_eur: EurReportingAggregate;
    ready_to_pay_eur: EurReportingAggregate;
    waiting_eur: EurReportingAggregate;
    paid_period_eur: EurReportingAggregate;
    payable_count: number;
    ready_count: number;
    fx_unavailable_count: number;
  };
  client_invoice?: {
    allocated_eur: number;
    paid_eur: number;
    remaining_eur: number;
    revenue_eur: number | null;
    margin_eur: number | null;
    margin_pct: number | null;
    team_member_count: number;
    payables: TeamMemberPayableEnriched[];
  } | null;
  reconciliation?: {
    unallocated_payouts: Array<{
      payout_id: string;
      person_id: string;
      amount: number;
      currency: string;
      payment_date: string | null;
      unallocated_amount: number;
    }>;
    unpaid_contractor_invoices: ContractorInvoice[];
    payable_count: number;
  } | null;
}

export interface FinancePayablesOverview {
  team_costs_accrued: number | null;
  ready_to_pay: number | null;
  team_payments_mtd: number | null;
  has_payable_data: boolean;
  has_unconverted: boolean;
}
