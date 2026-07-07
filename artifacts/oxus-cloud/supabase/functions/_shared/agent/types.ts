export type AgentRunStatus =
  | "pending"
  | "running"
  | "needs_confirmation"
  | "needs_clarification"
  | "confirmed"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ToolRunStatus =
  | "pending"
  | "needs_confirmation"
  | "confirmed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentMode = "auto" | "answer_only" | "memory_update" | "tool_request";

export type AgentToolName =
  | "update_project_memory"
  | "create_proposed_tasks"
  | "create_clickup_task"
  | "create_clickup_doc"
  | "link_clickup_doc_to_task"
  | "sync_clickup_docs"
  | "sync_slack_channel"
  | "ask_clarification_questions"
  | "answer_project_question"
  | "read_clickup_hierarchy"
  | "sync_clickup_hierarchy"
  | "create_clickup_folder"
  | "rename_clickup_folder"
  | "move_clickup_doc"
  | "move_clickup_task"
  | "archive_clickup_folder"
  | "create_clickup_list"
  | "rename_clickup_list";

export type AgentWorkflowStep = {
  tool_name: AgentToolName;
  step_key: string;
  requires_confirmation?: boolean;
  depends_on?: string[];
  input: Record<string, unknown>;
};

export type AgentWorkflowPlan = {
  workflow_name: string;
  steps: AgentWorkflowStep[];
};

export type AgentPlanToolCall = {
  tool_name: AgentToolName;
  /** Canonical tool input from the planner (may also arrive as input_payload on raw model output). */
  input: Record<string, unknown>;
  requires_confirmation: boolean;
};

export type AgentPlan = {
  detected_intent: string;
  answer?: string | null;
  memory_updates?: Record<string, unknown>;
  proposed_tasks?: Array<Record<string, unknown>>;
  clarification_questions?: Array<{
    question: string;
    reason: string;
    importance: "low" | "medium" | "high";
    blocks_task_creation?: boolean;
  }>;
  tool_calls: AgentPlanToolCall[];
  workflows?: AgentWorkflowPlan[];
  summary: string;
  confidence?: number;
};

export type RetrievalChunk = {
  id: string;
  source_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
  category?: string | null;
  similarity?: number;
};

export type AgentDiagnostics = {
  model?: string;
  retrieval_mode?: "vector" | "fallback";
  chunks_retrieved_count?: number;
  trigger_run_id?: string;
  trigger_enabled?: boolean;
  fallback_used?: boolean;
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
  runtime?: string;
  trigger_configured?: boolean;
  tool_calls_planned_count?: number;
  pending_tool_runs_count?: number;
  workflow_step_count?: number;
  clickup_connected?: boolean;
  // Accurate tool-call accounting (used to decide the external-action warning).
  total_tool_calls_planned?: number;
  safe_tool_calls_planned?: number;
  external_mutation_tool_calls_planned?: number;
  confirmation_required_tool_calls_planned?: number;
  tool_calls_created?: number;
  tool_calls_rejected?: number;
  rejected_tool_call_reasons?: Array<{ tool_name: string; reason: string }>;
  tool_validation_errors?: Array<{ tool_name: string; reason: string }>;
  proposed_tasks_created_count?: number;
  // PM Attention reconciliation
  attention_reconciliation_ran?: boolean;
  attention_open_before?: number;
  attention_resolved_count?: number;
  attention_updated_count?: number;
  attention_kept_open_count?: number;
  attention_new_questions_count?: number;
  attention_resolved_item_ids?: string[];
  warnings?: string[];
};

export type ProjectAgentRunInput = {
  project_id: string;
  user_id: string;
  agent_run_id: string;
  input_text?: string;
  uploaded_file_ids?: string[];
  mode?: AgentMode;
};
