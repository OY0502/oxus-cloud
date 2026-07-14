import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { hasRunningAgentToolRuns } from "@/lib/agentToolRunUtils";
import { deleteProjectRecord, purgeProjectStorage } from "@/lib/projectDelete";
import { parseEdgeFunctionError } from "@/lib/edgeFunctionErrors";
import {
  invoiceAmountDueEur,
  invoiceTotalEur,
} from "@/lib/invoiceEur";
import {
  isOutstandingReceivable,
  isOverdueReceivable,
  sumOverdueReceivablesEur,
  sumOutstandingReceivablesEur,
} from "@/lib/invoiceClassification";
import { summarizePaidRevenueRows } from "@/lib/paymentReconciliation";
import { getReportingMonthKey } from "@/lib/reportingTimezone";
import { getDefaultRate } from "@/lib/teamMemberRates";
import { loadPaidRevenueExclusions, savePaidRevenueExclusions } from "@/lib/paidRevenueExclusions";
import { buildGoogleSyncStatus, type GoogleSyncStatus } from "@/lib/googleSync";
import {
  googleSyncStatusFromCanonical,
  resolveCanonicalGoogleImportStatus,
  type GoogleCanonicalImportStatus,
} from "@/lib/googleImportStatus";
import { subscribeGoogleImportRun } from "@/lib/googleImportRunRealtime";
import type {
  Activity,
  AiProjectBrief,
  AiProposedTask,
  AiProposedTaskPriority,
  Attachment,
  CalendarEventWithAttendees,
  Client,
  ClickupMember,
  ProjectClickupAssignableMember,
  ClickupAssignableMembersSyncDiagnostics,
  ClickupTaskLink,
  Comment,
  Contact,
  DocType,
  EntityType,
  Invoice,
  InvoiceWithItems,
  Profile,
  ProfileRole,
  Project,
  ProjectAiStatusReport,
  ProjectClickupLink,
  ProjectClickupTimelineEvent,
  ProjectTimelineEvent,
  ProjectTimelineFilters,
  ProjectFigmaReference,
  ClickupDocSyncResult,
  ProjectKnowledgeChunk,
  ProjectKnowledgeSource,
  ProjectPmActionExecution,
  ProjectPmActionItem,
  ProjectPmProfile,
  PmDailyPlan,
  PmOpenActionItem,
  PmProjectAttention,
  PmRecentClickupActivity,
  PmStaleClickupTask,
  AiProcessingJob,
  AgentToolRun,
  ProcessAiJobsResult,
  ProjectAgentRun,
  ProjectAgentRunResult,
  ProjectSignal,
  ProjectSignalThread,
  ProjectSlackEvent,
  ProjectSlackLink,
  ReprocessSlackEventsResult,
  SlackPipelineDiagnostics,
  SlackSyncProjectChannelResult,
  SlackWorkspace,
  ProjectWithAssignees,
  UserClickupConnection,
  ClickupMyConnectionResponse,
  Quote,
  QuoteStage,
  QuoteWithRefs,
  Task,
  TaskPriority,
  TeamMember,
  TeamMemberWithStats,
  Technology,
  Transaction,
  TransactionType,
  NewAiProjectBrief,
  MemoryProcessingResult,
  ProjectPmAttentionItem,
  UpdateAiProposedTaskStatus,
  ProjectExecutionNote,
} from "@/lib/types";

// --------------------------------------------------------------------------
// Query keys
// --------------------------------------------------------------------------
export const qk = {
  clients: ["clients"] as const,
  contacts: ["contacts"] as const,
  profiles: ["profiles"] as const,
  teamMembers: ["team_members"] as const,
  technologies: ["technologies"] as const,
  quotes: ["quotes"] as const,
  projects: ["projects"] as const,
  invoices: ["invoices"] as const,
  events: ["calendar_events"] as const,
  transactions: ["transactions"] as const,
  activities: ["activities"] as const,
  comments: (t: EntityType, id: string) => ["comments", t, id] as const,
  tasks: (t: EntityType, id: string) => ["tasks", t, id] as const,
  attachments: (t: EntityType, id: string) => ["attachments", t, id] as const,
  aiProjectBriefs: (projectId: string) => ["ai_project_briefs", projectId] as const,
  aiProposedTasks: (projectId: string) => ["ai_proposed_tasks", projectId] as const,
  projectPmProfile: (projectId: string) => ["project_pm_profile", projectId] as const,
  projectPmAttentionItems: (projectId: string) => ["project_pm_attention_items", projectId] as const,
  projectKnowledgeSources: (projectId: string) => ["project_knowledge_sources", projectId] as const,
  projectKnowledgeChunks: (projectId: string) => ["project_knowledge_chunks", projectId] as const,
  projectFigmaReferences: (projectId: string) => ["project_figma_references", projectId] as const,
  projectClickupLink: (projectId: string) => ["project_clickup_link", projectId] as const,
  projectClickupTimeline: (projectId: string) => ["project_clickup_timeline", projectId] as const,
  projectTimelineEvents: (projectId: string, filters?: ProjectTimelineFilters) =>
    ["project_timeline_events", projectId, filters ?? {}] as const,
  clickupTaskLinks: (projectId: string) => ["clickup_task_links", projectId] as const,
  clickupMembers: (teamId: string) => ["clickup_members", teamId] as const,
  clickupAssignableMembers: (projectId: string) => ["clickup_assignable_members", projectId] as const,
  clickupListStatuses: (projectId: string) => ["clickup_list_statuses", projectId] as const,
  projectAiStatusReports: (projectId: string) => ["project_ai_status_reports", projectId] as const,
  projectPmActionItems: (projectId: string) => ["project_pm_action_items", projectId] as const,
  pmOpenActionItems: ["pm_open_action_items"] as const,
  pmProjectsNeedingAttention: ["pm_projects_needing_attention"] as const,
  pmRecentClickupActivity: ["pm_recent_clickup_activity"] as const,
  pmStaleClickupTasks: ["pm_stale_clickup_tasks"] as const,
  pmDailyPlans: ["pm_daily_plans"] as const,
  latestPmDailyPlan: ["pm_daily_plans", "latest"] as const,
  clickupMyConnection: ["clickup_my_connection"] as const,
  googleConnection: ["google_connection"] as const,
  crmImportCandidates: (status?: string) => ["crm_import_candidates", status ?? "pending"] as const,
  googleInteractions: (companyId?: string) => ["google_interactions", companyId ?? "all"] as const,
  googleCalendarEvents: ["google_calendar_events"] as const,
  clickupTeamSpaces: (projectId: string) => ["clickup_team_spaces", projectId] as const,
  slackWorkspaces: ["slack_workspaces"] as const,
  projectSlackLinks: (projectId: string) => ["project_slack_links", projectId] as const,
  projectSlackEvents: (projectId: string) => ["project_slack_events", projectId] as const,
  projectSignals: (projectId: string) => ["project_signals", projectId] as const,
  projectSignalThreads: (projectId: string) => ["project_signal_threads", projectId] as const,
  aiProcessingJobs: (projectId: string) => ["ai_processing_jobs", projectId] as const,
  projectAgentRuns: (projectId: string) => ["project_agent_runs", projectId] as const,
  agentToolRuns: (projectId: string, agentRunId?: string) =>
    ["agent_tool_runs", projectId, agentRunId ?? "all"] as const,
  slackPipelineDiagnostics: (projectId: string, linkId?: string) =>
    ["slack_pipeline_diagnostics", projectId, linkId ?? "all"] as const,
  pmRecentSlackSignals: ["pm_recent_slack_signals"] as const,
  projectExecutionNotes: (projectId: string) => ["project_execution_notes", projectId] as const,
  companyPeople: (companyId?: string) => ["company_people", companyId ?? "all"] as const,
  teamMemberRates: (personId: string) => ["team_member_rates", personId] as const,
  resolveTeamMemberRate: (personId: string, projectId?: string, workType?: string) =>
    ["resolve_team_member_rate", personId, projectId ?? "", workType ?? ""] as const,
  teamFinancialSummary: (personId: string, period?: string) =>
    ["team_financial_summary", personId, period ?? "mtd"] as const,
  rateUsage: (rateId: string) => ["rate_usage", rateId] as const,
  payouts: (personId?: string) => ["payouts", personId ?? "all"] as const,
  expenses: ["expenses"] as const,
  stripeConnection: ["stripe_connection"] as const,
  pandadocConnection: ["pandadoc_connection"] as const,
  companyMetrics: (companyId: string) => ["company_metrics", companyId] as const,
  teamMemberSummary: (personId: string) => ["team_member_summary", personId] as const,
  teamRoster: ["team_roster"] as const,
  teamKpis: ["team_kpis"] as const,
  contractorInvoices: (personId?: string) => ["contractor_invoices", personId ?? "all"] as const,
  contractorInvoiceSummary: (personId: string) => ["contractor_invoice_summary", personId] as const,
  contractorInvoice: (id: string) => ["contractor_invoice", id] as const,
  teamMemberPayables: (filters?: { personId?: string; clientInvoiceId?: string; projectId?: string }) =>
    ["team_member_payables", filters?.personId ?? "", filters?.clientInvoiceId ?? "", filters?.projectId ?? ""] as const,
  teamPayablesSummary: (filters?: { personId?: string; clientInvoiceId?: string; projectId?: string; period?: string }) =>
    ["team_payables_summary", filters?.personId ?? "", filters?.clientInvoiceId ?? "", filters?.projectId ?? "", filters?.period ?? ""] as const,
  payoutAllocations: (payoutId?: string) => ["payout_allocations", payoutId ?? "all"] as const,
  personProjectAssignments: (personId: string) => ["person_project_assignments", personId] as const,
  contactActivities: (contactId: string) => ["contact_activities", contactId] as const,
  crmPersonDetail: (personId: string) => ["crm_person_detail", personId] as const,
  crmPersonActivities: (personId: string, filter?: string, offset?: number) =>
    ["crm_person_activities", personId, filter ?? "all", offset ?? 0] as const,
  crmPersonSources: (personId: string) => ["crm_person_sources", personId] as const,
  invoiceMetrics: ["invoice_metrics"] as const,
  financeOverview: ["finance_overview"] as const,
  paidRevenueReconciliation: (month: string) => ["paid_revenue_reconciliation", month] as const,
  invoice: (id: string) => ["invoices", id] as const,
};

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as T;
}

async function throwEdgeFunctionError(error: unknown): Promise<never> {
  throw await parseEdgeFunctionError(error);
}

// --------------------------------------------------------------------------
// Clients (a.k.a. Organizations)
// --------------------------------------------------------------------------
export function useClients(): UseQueryResult<Client[]> {
  return useQuery({
    queryKey: qk.clients,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      return unwrap<Client[]>(data, error);
    },
  });
}

// Organizations are the same table as clients; alias for clarity in the UI.
export const useOrganizations = useClients;

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      website?: string | null;
      industry?: string | null;
      notes?: string | null;
      company_type?: Client["company_type"];
    }) => {
      const { data, error } = await supabase.from("clients").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data as Client;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clients }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Client> }) => {
      const { error } = await supabase.from("clients").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clients }),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clients }),
  });
}

// --------------------------------------------------------------------------
// Contacts (people)
// --------------------------------------------------------------------------
export function useContacts(options?: { enabled?: boolean }): UseQueryResult<Contact[]> {
  return useQuery({
    queryKey: qk.contacts,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("created_at", { ascending: false });
      return unwrap<Contact[]>(data, error);
    },
  });
}

export type NewContact = {
  name: string;
  type: Contact["type"];
  company?: string | null;
  client_id?: string | null;
  email?: string | null;
  phone?: string | null;
  relationship_strength?: Contact["relationship_strength"];
  source?: string | null;
  notes?: string | null;
  job_title?: string | null;
  hourly_rate?: number | null;
  availability?: string | null;
  location?: string | null;
  employment_type?: string | null;
  stack?: string[];
};

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewContact) => {
      const { data, error } = await supabase
        .from("contacts")
        .insert({ last_contact_at: new Date().toISOString(), ...input })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Contact;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.contacts }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Contact> }) => {
      const { error } = await supabase.from("contacts").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.contacts });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.teamKpis });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(vars.id) });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.contacts }),
  });
}

// --------------------------------------------------------------------------
// App users (profiles)
// --------------------------------------------------------------------------
export function useProfiles(): UseQueryResult<Profile[]> {
  return useQuery({
    queryKey: qk.profiles,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("full_name");
      return unwrap<Profile[]>(data, error);
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, full_name }: { id: string; full_name: string }) => {
      const { data, error } = await supabase
        .from("profiles")
        .update({ full_name })
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      await supabase.auth.updateUser({ data: { full_name } });
      return data as Profile;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.profiles }),
  });
}

export function useSetProfileRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: ProfileRole }) => {
      const { data, error } = await supabase.rpc("set_profile_role", {
        target_user_id: user_id,
        new_role: role,
      });
      if (error) throw new Error(error.message);
      return data as Profile;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.profiles }),
  });
}

export function useSetProfileAccessStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      user_id,
      access_status,
    }: {
      user_id: string;
      access_status: Extract<import("@/lib/types").ProfileAccessStatus, "active" | "blocked">;
    }) => {
      const { data, error } = await supabase.rpc("set_profile_access_status", {
        target_user_id: user_id,
        new_status: access_status,
      });
      if (error) throw new Error(error.message);
      return data as Profile;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.profiles }),
  });
}

export function useDeleteWorkspaceUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (user_id: string) => {
      const { error } = await supabase.rpc("delete_workspace_user", {
        target_user_id: user_id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.profiles }),
  });
}

export function useDeleteOwnAccount() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_own_account");
      if (error) throw new Error(error.message);
    },
  });
}

// --------------------------------------------------------------------------
// Team members (with derived active-project counts)
// --------------------------------------------------------------------------
export function useTeamMembers(): UseQueryResult<TeamMemberWithStats[]> {
  return useQuery({
    queryKey: qk.teamMembers,
    queryFn: async () => {
      const [members, stats] = await Promise.all([
        supabase.from("team_members").select("*").order("name"),
        supabase.from("team_member_stats").select("team_member_id, active_projects"),
      ]);
      if (members.error) throw new Error(members.error.message);
      if (stats.error) throw new Error(stats.error.message);
      const statMap = new Map<string, number>(
        (stats.data ?? []).map((s: any) => [s.team_member_id, s.active_projects ?? 0]),
      );
      return (members.data as TeamMember[]).map((m) => ({
        ...m,
        active_projects: statMap.get(m.id) ?? 0,
      }));
    },
  });
}

export type NewTeamMember = {
  name: string;
  job_title?: string | null;
  email?: string | null;
  location?: string | null;
  employment_type?: TeamMember["employment_type"];
  status?: TeamMember["status"];
  availability?: TeamMember["availability"];
  hourly_rate?: number | null;
  stack?: string[];
  notes?: string | null;
};

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewTeamMember) => {
      const { data, error } = await supabase.from("team_members").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data as TeamMember;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.teamMembers }),
  });
}

// --------------------------------------------------------------------------
// Technologies (configurable list)
// --------------------------------------------------------------------------
export function useTechnologies(): UseQueryResult<Technology[]> {
  return useQuery({
    queryKey: qk.technologies,
    queryFn: async () => {
      const { data, error } = await supabase.from("technologies").select("*").order("name");
      return unwrap<Technology[]>(data, error);
    },
  });
}

export function useCreateTechnology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color?: string | null }) => {
      const { data, error } = await supabase.from("technologies").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data as Technology;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.technologies }),
  });
}

export function useUpdateTechnology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Technology> }) => {
      const { error } = await supabase.from("technologies").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.technologies }),
  });
}

export function useDeleteTechnology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("technologies").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.technologies }),
  });
}

// --------------------------------------------------------------------------
// Quotes (unified pipeline + quotes entity, with related refs)
// --------------------------------------------------------------------------
const QUOTE_SELECT =
  "*, organization:clients!organization_id(*), point_of_contact:contacts!point_of_contact_id(*), technology:technologies!technology_id(*), assigned_user:profiles!assigned_user_id(*)";

export function useQuotes(options?: { enabled?: boolean }): UseQueryResult<QuoteWithRefs[]> {
  return useQuery({
    queryKey: qk.quotes,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select(QUOTE_SELECT)
        .order("position", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as QuoteWithRefs[];
    },
  });
}

export function useQuote(id: string | undefined): UseQueryResult<QuoteWithRefs | null> {
  return useQuery({
    queryKey: [...qk.quotes, id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("quotes").select(QUOTE_SELECT).eq("id", id!).single();
      if (error) throw new Error(error.message);
      return data as unknown as QuoteWithRefs;
    },
  });
}

export type NewQuote = {
  company: string;
  number?: string | null;
  organization_id?: string | null;
  point_of_contact_id?: string | null;
  contact_name?: string | null;
  technology_id?: string | null;
  project_type?: string | null;
  budget?: number;
  stage?: QuoteStage;
  urgency?: Quote["urgency"];
  next_action?: string | null;
  project_name?: string | null;
  project_description?: string | null;
  tags?: string[];
  assigned_user_id?: string | null;
  company_website_url?: string | null;
  request_message?: string | null;
};

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewQuote) => {
      const { data, error } = await supabase
        .from("quotes")
        .insert({ stage: "new-lead", ...input })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Quote;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.quotes }),
  });
}

export function useUpdateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Quote> }) => {
      const { error } = await supabase.from("quotes").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.quotes }),
  });
}

export function useUpdateQuoteStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: QuoteStage }) => {
      const { error } = await supabase
        .from("quotes")
        .update({ stage, stage_entered_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.quotes }),
  });
}

// Create a DRAFT project pre-populated from a quote, and link them.
export function useConvertQuoteToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quote: Quote | QuoteWithRefs) => {
      const name = quote.project_name || quote.number || quote.company || "New project";
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name,
          description: quote.project_description ?? null,
          is_draft: true,
          draft_step: 1,
          source_quote_id: quote.id,
          client_id: quote.organization_id ?? quote.client_id ?? null,
          organization_id: quote.organization_id ?? null,
          point_of_contact_id: quote.point_of_contact_id ?? null,
          technology_id: quote.technology_id ?? null,
          project_type: quote.project_type ?? null,
          budget: quote.budget ?? 0,
          company_website_url: quote.company_website_url ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const project = data as Project;
      const { error: uErr } = await supabase
        .from("quotes")
        .update({ converted_project_id: project.id, stage: "won", stage_entered_at: new Date().toISOString() })
        .eq("id", quote.id);
      if (uErr) throw new Error(uErr.message);
      return project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.quotes });
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

// --------------------------------------------------------------------------
// Firecrawl company website enrichment (server-side only)
// --------------------------------------------------------------------------
export type EnrichProjectFromWebsiteInput = {
  project_id: string;
  company_website_url?: string | null;
  request_message?: string | null;
  proposal_id?: string | null;
  force?: boolean;
};

export type EnrichProjectFromWebsiteResult = {
  async?: boolean;
  trigger_run_id?: string;
  status?: string;
  skipped?: boolean;
  reason?: string;
  message?: string;
  pages_scraped?: number;
  sources_created?: number;
  sources_updated?: number;
  sources_skipped_unchanged?: number;
  initial_intelligence_generated?: boolean;
  warnings?: string[];
  langfuse_trace_url?: string;
};

/**
 * Queue (or run) server-side Firecrawl enrichment for a project's exact company
 * website. Never calls Firecrawl from the browser — this only invokes the
 * `enrich-project-from-website` Edge Function, which enforces auth + scoping.
 */
export function useEnrichProjectFromWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EnrichProjectFromWebsiteInput) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in to enrich a project.");

      const { data, error } = await supabase.functions.invoke<EnrichProjectFromWebsiteResult>(
        "enrich-project-from-website",
        {
          body: input,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      return (data ?? {}) as EnrichProjectFromWebsiteResult;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: [...qk.projects, input.project_id] });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeSources(input.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeChunks(input.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmProfile(input.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmAttentionItems(input.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProjectBriefs(input.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(input.project_id) });
    },
  });
}

// --------------------------------------------------------------------------
// Projects (with assignees)
// --------------------------------------------------------------------------
const PROJECT_SELECT =
  "*, owner:profiles!owner_id(*), project_contact_assignees(contacts(*)), organization:clients!projects_organization_id_fkey(logo_url), client:clients!projects_client_id_fkey(logo_url)";

function mapProject(p: any): ProjectWithAssignees {
  const clientLogo =
    p.organization?.logo_url ?? p.client?.logo_url ?? null;
  const { organization: _org, client: _client, project_contact_assignees, ...rest } = p;
  return {
    ...rest,
    owner: (p.owner ?? null) as Profile | null,
    assignees: [],
    team_contacts: (project_contact_assignees ?? [])
      .map((pa: any) => pa.contacts)
      .filter(Boolean) as Contact[],
    client_logo_url: clientLogo,
  };
}

export function useProjects(options?: { enabled?: boolean }): UseQueryResult<ProjectWithAssignees[]> {
  return useQuery({
    queryKey: qk.projects,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select(PROJECT_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapProject);
    },
  });
}

export function useProject(id: string | undefined): UseQueryResult<ProjectWithAssignees | null> {
  return useQuery({
    queryKey: [...qk.projects, id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select(PROJECT_SELECT).eq("id", id!).single();
      if (error) throw new Error(error.message);
      return mapProject(data);
    },
    // While company enrichment is queued/running in the background (Trigger.dev),
    // poll so the UI reflects the terminal status once the task finishes. Polling
    // stops automatically as soon as the status is succeeded/failed/not_started.
    refetchInterval: (query) => {
      const status = query.state.data?.company_enrichment_status;
      return status === "queued" || status === "running" ? 4000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export type NewProject = {
  name: string;
  description?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  status?: Project["status"];
  priority?: Project["priority"];
  health?: Project["health"];
  risk?: Project["risk"];
  progress?: number;
  budget?: number;
  start_date?: string | null;
  deadline?: string | null;
  is_draft?: boolean;
  draft_step?: number;
  source_quote_id?: string | null;
  organization_id?: string | null;
  point_of_contact_id?: string | null;
  technology_id?: string | null;
  owner_id?: string | null;
  project_type?: string | null;
  company_website_url?: string | null;
  assignee_user_ids?: string[];
  contact_assignee_ids?: string[];
};

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contact_assignee_ids = [], ...input }: NewProject) => {
      const { data, error } = await supabase.from("projects").insert(input).select().single();
      if (error) throw new Error(error.message);
      const project = data as Project;
      if (contact_assignee_ids.length > 0) {
        const rows = contact_assignee_ids.map((contact_id) => ({ project_id: project.id, contact_id }));
        const { error: aErr } = await supabase.from("project_contact_assignees").insert(rows);
        if (aErr) throw new Error(aErr.message);
      }
      return project;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
      assignee_user_ids,
      contact_assignee_ids,
    }: {
      id: string;
      patch: Partial<Project>;
      assignee_user_ids?: string[];
      contact_assignee_ids?: string[];
    }) => {
      const { error } = await supabase.from("projects").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      if (contact_assignee_ids) {
        await supabase.from("project_contact_assignees").delete().eq("project_id", id);
        if (contact_assignee_ids.length > 0) {
          const rows = contact_assignee_ids.map((contact_id) => ({ project_id: id, contact_id }));
          const { error: aErr } = await supabase.from("project_contact_assignees").insert(rows);
          if (aErr) throw new Error(aErr.message);
        }
      }
      if (assignee_user_ids) {
        await supabase.from("project_user_assignees").delete().eq("project_id", id);
        if (assignee_user_ids.length > 0) {
          const rows = assignee_user_ids.map((user_id) => ({ project_id: id, user_id }));
          const { error: aErr } = await supabase.from("project_user_assignees").insert(rows);
          if (aErr) throw new Error(aErr.message);
        }
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: [...qk.projects, vars.id] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, image_path }: { id: string; image_path?: string | null }) => {
      await purgeProjectStorage(id, image_path);
      await deleteProjectRecord(id);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.removeQueries({ queryKey: [...qk.projects, vars.id] });
      qc.invalidateQueries({ queryKey: qk.pmOpenActionItems });
      qc.invalidateQueries({ queryKey: qk.pmProjectsNeedingAttention });
      qc.invalidateQueries({ queryKey: qk.pmRecentClickupActivity });
      qc.invalidateQueries({ queryKey: qk.pmStaleClickupTasks });
      qc.invalidateQueries({ queryKey: qk.pmRecentSlackSignals });
    },
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("archive_project", {
        p_project_id: id,
        p_reason: reason?.trim() || null,
      });
      if (error) throw new Error(error.message);
      return data as Project;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: [...qk.projects, vars.id] });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.id) });
      qc.invalidateQueries({ queryKey: qk.pmOpenActionItems });
      qc.invalidateQueries({ queryKey: qk.pmProjectsNeedingAttention });
    },
  });
}

export function useRestoreProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase.rpc("restore_project", {
        p_project_id: id,
      });
      if (error) throw new Error(error.message);
      return data as Project;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: [...qk.projects, vars.id] });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.id) });
      qc.invalidateQueries({ queryKey: qk.pmOpenActionItems });
      qc.invalidateQueries({ queryKey: qk.pmProjectsNeedingAttention });
    },
  });
}

// --------------------------------------------------------------------------
// AI project briefs and proposed tasks
// --------------------------------------------------------------------------
export type CreateAiProjectBriefResult = MemoryProcessingResult;

export function useProjectPmAttentionItems(projectId: string): UseQueryResult<ProjectPmAttentionItem[]> {
  return useQuery({
    queryKey: qk.projectPmAttentionItems(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_pm_attention_items")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<ProjectPmAttentionItem[]>(data, error);
    },
  });
}

export function useSkipPmAttentionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, project_id }: { id: string; project_id: string }) => {
      const { error } = await supabase
        .from("project_pm_attention_items")
        .update({ status: "skipped" })
        .eq("id", id)
        .eq("project_id", project_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectPmAttentionItems(vars.project_id) });
    },
  });
}

export function useClearPmAttentionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, project_id }: { id: string; project_id: string }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id ?? null;
      const { error } = await supabase
        .from("project_pm_attention_items")
        .update({
          status: "cleared",
          cleared_at: new Date().toISOString(),
          cleared_by: userId,
        })
        .eq("id", id)
        .eq("project_id", project_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectPmAttentionItems(vars.project_id) });
    },
  });
}

export function useAnswerPmAttentionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      project_id,
      answer_text,
    }: {
      id: string;
      project_id: string;
      answer_text: string;
    }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in to answer.");

      const { data, error } = await supabase.functions.invoke<MemoryProcessingResult>(
        "generate-project-brief",
        {
          body: {
            project_id,
            input_text: answer_text,
            source_type: "auto",
            source_title: "Clarification answer",
            metadata: { attention_item_id: id, is_clarification_answer: true },
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No processing result was returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectPmAttentionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProjectBriefs(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmProfile(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeSources(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeChunks(vars.project_id) });
    },
  });
}

export function useAiProjectBriefs(projectId: string): UseQueryResult<AiProjectBrief[]> {
  return useQuery({
    queryKey: qk.aiProjectBriefs(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_project_briefs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<AiProjectBrief[]>(data, error);
    },
  });
}

export function useAiProposedTasks(projectId: string): UseQueryResult<AiProposedTask[]> {
  return useQuery({
    queryKey: qk.aiProposedTasks(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_proposed_tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<AiProposedTask[]>(data, error);
    },
  });
}

export function useProjectPmProfile(projectId: string): UseQueryResult<ProjectPmProfile | null> {
  return useQuery({
    queryKey: qk.projectPmProfile(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_pm_profiles")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as ProjectPmProfile | null;
    },
  });
}

export type UpdateProjectPmProfileInput = {
  project_id: string;
  updates: Partial<
    Pick<
      ProjectPmProfile,
      | "business_goal"
      | "target_users"
      | "core_flows"
      | "scope_in"
      | "scope_out"
      | "success_criteria"
      | "assumptions"
      | "constraints"
      | "risks"
      | "open_questions"
      | "qa_strategy"
      | "technical_notes"
      | "delivery_notes"
      | "current_phase"
    >
  >;
};

export function useUpdateProjectPmProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ project_id, updates }: UpdateProjectPmProfileInput) => {
      const { data, error } = await supabase
        .from("project_pm_profiles")
        .update(updates)
        .eq("project_id", project_id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as ProjectPmProfile;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.projectPmProfile(data.project_id) });
    },
  });
}

export function useProjectKnowledgeSources(projectId: string): UseQueryResult<ProjectKnowledgeSource[]> {
  return useQuery({
    queryKey: qk.projectKnowledgeSources(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_knowledge_sources")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<ProjectKnowledgeSource[]>(data, error);
    },
  });
}

export function useProjectKnowledgeChunks(projectId: string): UseQueryResult<ProjectKnowledgeChunk[]> {
  return useQuery({
    queryKey: qk.projectKnowledgeChunks(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_knowledge_chunks")
        .select("*")
        .eq("project_id", projectId)
        .order("chunk_index", { ascending: true });
      return unwrap<ProjectKnowledgeChunk[]>(data, error);
    },
  });
}

export function useCreateAiProjectBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewAiProjectBrief) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in to generate an AI brief.");

      const { data, error } = await supabase.functions.invoke<CreateAiProjectBriefResult>(
        "generate-project-brief",
        {
          body: input,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No AI brief was returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.aiProjectBriefs(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmProfile(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeSources(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeChunks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmAttentionItems(vars.project_id) });
    },
  });
}

export function useProjectAgentRuns(projectId: string): UseQueryResult<ProjectAgentRun[]> {
  return useQuery({
    queryKey: qk.projectAgentRuns(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_agent_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10);
      return unwrap<ProjectAgentRun[]>(data, error);
    },
  });
}

export function useAgentToolRuns(projectId: string, agentRunId?: string): UseQueryResult<AgentToolRun[]> {
  return useQuery({
    queryKey: qk.agentToolRuns(projectId, agentRunId),
    enabled: !!projectId,
    queryFn: async () => {
      let query = supabase
        .from("agent_tool_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (agentRunId) query = query.eq("agent_run_id", agentRunId);
      const { data, error } = await query;
      return unwrap<AgentToolRun[]>(data, error);
    },
    refetchInterval: (query) => (hasRunningAgentToolRuns(query.state.data ?? []) ? 3000 : false),
  });
}

export function useRunProjectAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      input_text: string;
      uploaded_file_ids?: string[];
      mode?: "auto" | "answer_only" | "memory_update" | "tool_request";
    }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in.");

      const { data, error } = await supabase.functions.invoke<ProjectAgentRunResult>("project-agent-run", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No agent result was returned.");
      if (import.meta.env.DEV) {
        console.info("[project-agent-run]", {
          agent_run_id: data.agent_run_id,
          trigger_enabled: data.trigger_enabled,
          trigger_run_id: data.trigger_run_id,
          fallback_used: data.fallback_used,
          warning: data.warning,
        });
      }
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectAgentRuns(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.agentToolRuns(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmProfile(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeSources(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeChunks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmAttentionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      if (_d?.agent_run_id) {
        qc.invalidateQueries({ queryKey: ["project_agent_run", _d.agent_run_id] });
      }
    },
  });
}

export function useConfirmAgentToolRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      tool_run_id: string;
      input_payload_overrides?: Record<string, unknown>;
      cancel?: boolean;
    }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in.");

      const { data, error } = await supabase.functions.invoke("confirm-agent-tool-run", {
        body: {
          tool_run_id: input.tool_run_id,
          input_payload_overrides: input.input_payload_overrides,
          cancel: input.cancel,
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data as Record<string, unknown>;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.agentToolRuns(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectAgentRuns(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeSources(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: qk.agentToolRuns(vars.project_id) });
    },
  });
}

export function useConfirmAgentWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      workflow_id: string;
      step_overrides?: Record<string, Record<string, unknown>>;
      cancel?: boolean;
    }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in.");

      const { data, error } = await supabase.functions.invoke("confirm-agent-workflow", {
        body: {
          project_id: input.project_id,
          workflow_id: input.workflow_id,
          step_overrides: input.step_overrides,
          cancel: input.cancel,
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data as Record<string, unknown>;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.agentToolRuns(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectAgentRuns(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: qk.agentToolRuns(vars.project_id) });
    },
  });
}

export function useSyncClickupProjectHierarchy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; force?: boolean }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in.");

      const { data, error } = await supabase.functions.invoke("clickup-sync-project-hierarchy", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data as {
        folders_synced: number;
        lists_synced: number;
        docs_synced: number;
        pages_synced: number;
        warnings: string[];
      };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectAgentRuns(vars.project_id) });
    },
  });
}

export function useSyncClickupProjectDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (project_id: string) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in.");

      const { data, error } = await supabase.functions.invoke("clickup-sync-project-docs", {
        body: { project_id },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data as ClickupDocSyncResult;
    },
    onSuccess: (_d, projectId) => {
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeSources(projectId) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeChunks(projectId) });
      qc.invalidateQueries({ queryKey: qk.projectPmProfile(projectId) });
      qc.invalidateQueries({ queryKey: qk.aiProjectBriefs(projectId) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(projectId) });
    },
  });
}

export function useProjectAgentRun(agentRunId: string | undefined) {
  return useQuery({
    queryKey: ["project_agent_run", agentRunId],
    enabled: !!agentRunId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "running" || status === "pending") return 2000;
      return false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_agent_runs")
        .select("*")
        .eq("id", agentRunId!)
        .single();
      if (error) throw new Error(error.message);
      return data as ProjectAgentRun;
    },
  });
}

export function useTriggerSmokeTest() {
  return useMutation({
    mutationFn: async (message?: string) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in.");

      const { data, error } = await supabase.functions.invoke("trigger-smoke-test", {
        body: message ? { message } : {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data as Record<string, unknown>;
    },
  });
}

export function useUpdateAiProposedTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: UpdateAiProposedTaskStatus) => {
      const { error } = await supabase.from("ai_proposed_tasks").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) }),
  });
}

export function useProjectFigmaReferences(projectId: string): UseQueryResult<ProjectFigmaReference[]> {
  return useQuery({
    queryKey: qk.projectFigmaReferences(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_figma_references")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<ProjectFigmaReference[]>(data, error);
    },
  });
}

export type ImportFigmaContextResult = {
  reference: ProjectFigmaReference;
  source: ProjectKnowledgeSource;
  profile: ProjectPmProfile;
  figma_summary: {
    summary: string;
    screens: string[];
    flows: string[];
    components: string[];
    design_notes: string[];
    implementation_notes: string[];
    open_questions: string[];
  };
  tasks: AiProposedTask[];
};

export function useImportFigmaContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; figma_url: string; source_title?: string }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("You must be signed in to import Figma context.");

      const { data, error } = await supabase.functions.invoke<ImportFigmaContextResult>("import-figma-context", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No Figma context was returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectFigmaReferences(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmProfile(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectKnowledgeSources(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) });
    },
  });
}

// Convert an accepted AI proposed task into exactly one real internal project task.
export function useAcceptAiProposedTaskAsProjectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ proposedTaskId, projectId }: { proposedTaskId: string; projectId: string }) => {
      const { data: proposed, error: loadError } = await supabase
        .from("ai_proposed_tasks")
        .select("*")
        .eq("id", proposedTaskId)
        .single();
      if (loadError) throw new Error(loadError.message);
      const task = proposed as AiProposedTask;

      const { data: existing, error: existingError } = await supabase
        .from("tasks")
        .select("*")
        .eq("source_ai_proposed_task_id", proposedTaskId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);

      if (existing) {
        await supabase.from("ai_proposed_tasks").update({ status: "accepted" }).eq("id", proposedTaskId);
        return existing as Task;
      }

      const { data: created, error: createError } = await supabase
        .from("tasks")
        .insert({
          entity_type: "project",
          entity_id: projectId,
          title: task.title,
          description: task.description,
          priority: task.priority,
          acceptance_criteria: task.acceptance_criteria,
          qa_scenarios: task.qa_scenarios,
          implementation_notes: task.implementation_notes,
          design_notes: task.design_notes,
          estimate_hours: task.estimate_hours,
          source_type: task.figma_file_key ? "figma" : "ai_proposed_task",
          source_ai_proposed_task_id: task.id,
          source_ai_brief_id: task.brief_id,
          source_knowledge_source_id: task.source_knowledge_source_id,
          figma_file_key: task.figma_file_key,
          figma_node_ids: task.figma_node_ids,
          design_url: task.design_url,
          status: "todo",
        })
        .select()
        .single();
      if (createError) throw new Error(createError.message);

      const { error: statusError } = await supabase
        .from("ai_proposed_tasks")
        .update({ status: "accepted" })
        .eq("id", proposedTaskId);
      if (statusError) throw new Error(statusError.message);

      return created as Task;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.projectId) });
      qc.invalidateQueries({ queryKey: qk.tasks("project", vars.projectId) });
    },
  });
}

// --------------------------------------------------------------------------
// Comments (polymorphic: quote | project)
// --------------------------------------------------------------------------
export function useComments(entityType: EntityType, entityId: string | undefined): UseQueryResult<Comment[]> {
  return useQuery({
    queryKey: qk.comments(entityType, entityId ?? ""),
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comments")
        .select("*, author:profiles!author_id(*)")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Comment[];
    },
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entity_type: EntityType; entity_id: string; body: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("comments")
        .insert({ ...input, author_id: auth.user?.id ?? null });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.comments(vars.entity_type, vars.entity_id) }),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: { id: string; entity_type: EntityType; entity_id: string }) => {
      const { error } = await supabase.from("comments").delete().eq("id", c.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.comments(vars.entity_type, vars.entity_id) }),
  });
}

// --------------------------------------------------------------------------
// Tasks (polymorphic: quote | project)
// --------------------------------------------------------------------------
export function useTasks(entityType: EntityType, entityId: string | undefined): UseQueryResult<Task[]> {
  return useQuery({
    queryKey: qk.tasks(entityType, entityId ?? ""),
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, assignee:profiles!assignee_id(*)")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId!)
        .order("position", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Task[];
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      entity_type: EntityType;
      entity_id: string;
      title: string;
      assignee_id?: string | null;
      due_date?: string | null;
      description?: string | null;
      priority?: Task["priority"];
    }) => {
      const { error } = await supabase.from("tasks").insert(input);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.tasks(vars.entity_type, vars.entity_id) }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      entity_type: EntityType;
      entity_id: string;
      patch: Partial<Pick<Task, "title" | "status" | "assignee_id" | "due_date" | "position">>;
    }) => {
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.tasks(vars.entity_type, vars.entity_id) }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: { id: string; entity_type: EntityType; entity_id: string }) => {
      const { error } = await supabase.from("tasks").delete().eq("id", t.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.tasks(vars.entity_type, vars.entity_id) }),
  });
}

// --------------------------------------------------------------------------
// Attachments / documents (polymorphic) backed by the `documents` bucket
// --------------------------------------------------------------------------
export const DOCUMENTS_BUCKET = "documents";

export function useAttachments(entityType: EntityType, entityId: string | undefined): UseQueryResult<Attachment[]> {
  return useQuery({
    queryKey: qk.attachments(entityType, entityId ?? ""),
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attachments")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Attachment[];
    },
  });
}

export async function getAttachmentUrl(filePath: string | null | undefined): Promise<string | null> {
  if (!filePath) return null;
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(filePath, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      entity_type: EntityType;
      entity_id: string;
      file: File;
      doc_type?: DocType;
    }) => {
      const { entity_type, entity_id, file, doc_type = "attachment" } = input;
      const { data: auth } = await supabase.auth.getUser();
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${entity_type}/${entity_id}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
      if (upErr) throw new Error(upErr.message);

      // Active SOW supersession: a new active SOW pushes the previous one to "other".
      if (doc_type === "sow") {
        await supabase
          .from("attachments")
          .update({
            doc_type: "other",
            is_active: false,
            superseded_at: new Date().toISOString(),
          })
          .eq("entity_type", entity_type)
          .eq("entity_id", entity_id)
          .eq("doc_type", "sow")
          .eq("is_active", true);
      }

      const { error: insErr } = await supabase.from("attachments").insert({
        entity_type,
        entity_id,
        doc_type,
        is_active: true,
        provider: "upload",
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: auth.user?.id ?? null,
        title: file.name,
      });
      if (insErr) throw new Error(insErr.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.attachments(vars.entity_type, vars.entity_id) }),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: Attachment) => {
      if ((a.provider ?? "upload") === "upload" && a.file_path) {
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([a.file_path]);
      }
      const { error } = await supabase.from("attachments").delete().eq("id", a.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: qk.attachments(vars.entity_type, vars.entity_id) }),
  });
}

export async function uploadProjectAgentIntakeFile(projectId: string, file: File): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `project/${projectId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (upErr) throw new Error(upErr.message);

  const { data, error: insErr } = await supabase
    .from("attachments")
    .insert({
      entity_type: "project",
      entity_id: projectId,
      doc_type: "attachment",
      is_active: true,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || null,
      uploaded_by: auth.user?.id ?? null,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);
  return data.id as string;
}

// --------------------------------------------------------------------------
// Project execution notes (not AI memory)
// --------------------------------------------------------------------------
export function useProjectExecutionNotes(projectId: string): UseQueryResult<ProjectExecutionNote[]> {
  return useQuery({
    queryKey: qk.projectExecutionNotes(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_execution_notes")
        .select("*, author:profiles(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<ProjectExecutionNote[]>(data, error);
    },
  });
}

export function useCreateProjectExecutionNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; note_text: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("project_execution_notes")
        .insert({
          project_id: input.project_id,
          author_id: auth.user?.id ?? null,
          note_text: input.note_text.trim(),
        })
        .select("*, author:profiles(*)")
        .single();
      if (error) throw new Error(error.message);
      return data as ProjectExecutionNote;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.projectExecutionNotes(data.project_id) });
    },
  });
}

export function useUpdateProjectExecutionNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string; note_text: string }) => {
      const { data, error } = await supabase
        .from("project_execution_notes")
        .update({ note_text: input.note_text.trim() })
        .eq("id", input.id)
        .eq("project_id", input.project_id)
        .select("*, author:profiles(*)")
        .single();
      if (error) throw new Error(error.message);
      return data as ProjectExecutionNote;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.projectExecutionNotes(data.project_id) });
    },
  });
}

export function useDeleteProjectExecutionNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await supabase
        .from("project_execution_notes")
        .delete()
        .eq("id", input.id)
        .eq("project_id", input.project_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectExecutionNotes(vars.project_id) });
    },
  });
}

// --------------------------------------------------------------------------
// Invoices (with line items)
// --------------------------------------------------------------------------
export function useInvoices(options?: { enabled?: boolean }): UseQueryResult<InvoiceWithItems[]> {
  return useQuery({
    queryKey: qk.invoices,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, invoice_line_items(*)")
        .order("issued_at", { ascending: false, nullsFirst: false })
        .order("issue_date", { ascending: false });
      if (error) throw new Error(error.message);
      const invoiceCreatedAt = (inv: InvoiceWithItems) =>
        new Date(inv.issued_at ?? `${inv.issue_date}T12:00:00`).getTime();
      return (data ?? [])
        .map((inv: any) => ({
          ...inv,
          line_items: (inv.invoice_line_items ?? []).sort((a: any, b: any) => a.position - b.position),
        }))
        .sort((a: InvoiceWithItems, b: InvoiceWithItems) => invoiceCreatedAt(b) - invoiceCreatedAt(a)) as InvoiceWithItems[];
    },
  });
}

export type NewInvoice = {
  number: string;
  client_id?: string | null;
  client_name?: string | null;
  project_id?: string | null;
  project?: string | null;
  amount?: number;
  status?: Invoice["status"];
  issue_date?: string;
  due_date?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  line_items?: { description: string; amount: number }[];
};

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ line_items = [], ...input }: NewInvoice) => {
      const { data, error } = await supabase
        .from("invoices")
        .insert({ stripe_status: "Draft", ...input })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const invoice = data as { id: string };
      if (line_items.length > 0) {
        const rows = line_items.map((li, i) => ({ invoice_id: invoice.id, description: li.description, amount: li.amount, position: i }));
        const { error: liErr } = await supabase.from("invoice_line_items").insert(rows);
        if (liErr) throw new Error(liErr.message);
      }
      return invoice;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invoices }),
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Invoice> }) => {
      const { error } = await supabase.from("invoices").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invoices }),
  });
}

// --------------------------------------------------------------------------
// Calendar events (with attendees)
// --------------------------------------------------------------------------
export function useCalendarEvents(): UseQueryResult<CalendarEventWithAttendees[]> {
  return useQuery({
    queryKey: qk.events,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calendar_events")
        .select("*, event_user_attendees(profiles(*))")
        .order("event_date", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((e: any) => ({
        ...e,
        attendees: (e.event_user_attendees ?? [])
          .map((a: any) => a.profiles)
          .filter(Boolean) as Profile[],
      })) as CalendarEventWithAttendees[];
    },
  });
}

export type NewCalendarEvent = {
  title: string;
  event_date: string;
  start_time?: string | null;
  end_time?: string | null;
  type?: CalendarEventWithAttendees["type"];
  location?: string | null;
  color?: string | null;
  attendee_user_ids?: string[];
};

const EVENT_COLORS: Record<string, string> = {
  meeting: "var(--color-chart-1)",
  design: "var(--color-chart-2)",
  internal: "var(--color-chart-3)",
  milestone: "var(--color-chart-5)",
};

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ attendee_user_ids = [], ...input }: NewCalendarEvent) => {
      const color = input.color ?? EVENT_COLORS[input.type ?? "meeting"] ?? "var(--color-chart-1)";
      const { data, error } = await supabase
        .from("calendar_events")
        .insert({ ...input, color })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const event = data as { id: string };
      if (attendee_user_ids.length > 0) {
        const rows = attendee_user_ids.map((user_id) => ({ event_id: event.id, user_id }));
        const { error: aErr } = await supabase.from("event_user_attendees").insert(rows);
        if (aErr) throw new Error(aErr.message);
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.events }),
  });
}

// --------------------------------------------------------------------------
// Transactions
// --------------------------------------------------------------------------
export function useTransactions(): UseQueryResult<Transaction[]> {
  return useQuery({
    queryKey: qk.transactions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .order("occurred_on", { ascending: false });
      return unwrap<Transaction[]>(data, error);
    },
  });
}

export type NewTransaction = {
  description: string;
  amount: number;
  category: string;
  type: TransactionType;
  occurred_on?: string;
};

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewTransaction) => {
      const { data, error } = await supabase.from("transactions").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data as Transaction;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.transactions }),
  });
}

// --------------------------------------------------------------------------
// Activities
// --------------------------------------------------------------------------
export function useActivities(
  limit = 8,
  options?: { enabled?: boolean },
): UseQueryResult<Activity[]> {
  return useQuery({
    queryKey: [...qk.activities, limit],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      return unwrap<Activity[]>(data, error);
    },
  });
}

// --------------------------------------------------------------------------
// ClickUp integration
// --------------------------------------------------------------------------
async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("You must be signed in.");
  return token;
}

export function useProjectClickupLink(projectId: string): UseQueryResult<ProjectClickupLink | null> {
  return useQuery({
    queryKey: qk.projectClickupLink(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_clickup_links")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as ProjectClickupLink | null;
    },
  });
}

export function useProjectClickupTimeline(projectId: string): UseQueryResult<ProjectClickupTimelineEvent[]> {
  return useQuery({
    queryKey: qk.projectClickupTimeline(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_clickup_timeline_events")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100);
      return unwrap<ProjectClickupTimelineEvent[]>(data, error);
    },
  });
}

export function useProjectTimelineEvents(
  projectId: string,
  filters?: ProjectTimelineFilters,
): UseQueryResult<ProjectTimelineEvent[]> {
  return useQuery({
    queryKey: qk.projectTimelineEvents(projectId, filters),
    enabled: !!projectId,
    queryFn: async () => {
      let query = supabase
        .from("project_timeline_events")
        .select("*")
        .eq("project_id", projectId)
        .order("source_created_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(100);

      if (filters?.sourceType && filters.sourceType !== "all") {
        query = query.eq("source_type", filters.sourceType);
      }
      if (filters?.signalType && filters.signalType !== "all") {
        query = query.eq("signal_type", filters.signalType);
      }

      const { data, error } = await query;
      return unwrap<ProjectTimelineEvent[]>(data, error);
    },
  });
}

export function useBackfillProjectTimeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        clickup_synced: number;
        slack_signals_synced: number;
        actions_created: number;
        actions_updated: number;
        timeline_events_created: number;
      }>("backfill-project-timeline", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.ok) throw new Error("Timeline backfill failed.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSlackEvents(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignals(vars.project_id) });
    },
  });
}

export function useClickupTaskLinks(projectId: string): UseQueryResult<ClickupTaskLink[]> {
  return useQuery({
    queryKey: qk.clickupTaskLinks(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clickup_task_links")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<ClickupTaskLink[]>(data, error);
    },
  });
}

export function useClickupMyConnection(): UseQueryResult<ClickupMyConnectionResponse> {
  return useQuery({
    queryKey: qk.clickupMyConnection,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<ClickupMyConnectionResponse>("clickup-my-connection", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data ?? { connected: false, connection: null };
    },
  });
}

export function useStartClickupOAuth() {
  return useMutation({
    mutationFn: async (input?: { redirect_after?: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ auth_url: string }>("clickup-oauth-start", {
        body: input ?? {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.auth_url) throw new Error("No ClickUp OAuth URL returned.");
      return data;
    },
  });
}

export function useDisconnectClickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ success: boolean }>("clickup-disconnect", {
        body: { confirm: true },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clickupMyConnection });
    },
  });
}

export type GoogleConnectionStatusResponse = {
  connected: boolean;
  connection: import("@/lib/types").GoogleConnectionSafe | null;
  latest_import?: import("@/lib/types").GoogleImportRun | null;
  active_import?: import("@/lib/types").GoogleImportRun | null;
  sync_stage?: import("@/lib/types").GoogleSyncStage | string;
  canonical_status?: import("@/lib/googleImportStatus").GoogleCanonicalImportStatus | null;
  gmail_scope_granted?: boolean;
};

export type GoogleSyncNowResponse = {
  accepted: boolean;
  already_running: boolean;
  import_run_id: string;
  trigger_run_id?: string;
  status: string;
  queued?: boolean;
  counts?: Record<string, number>;
};

function invalidateGoogleCrmData(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.googleConnection });
  qc.invalidateQueries({ queryKey: qk.clients });
  qc.invalidateQueries({ queryKey: qk.contacts });
  qc.invalidateQueries({ queryKey: qk.quotes });
  qc.invalidateQueries({ queryKey: qk.crmImportCandidates() });
  qc.invalidateQueries({ queryKey: qk.googleCalendarEvents });
}

export function useGoogleConnectionStatus(options?: { refetchInterval?: number | false; enabled?: boolean }): UseQueryResult<GoogleConnectionStatusResponse> {
  return useQuery({
    queryKey: qk.googleConnection,
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<GoogleConnectionStatusResponse>("google-connection-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data ?? { connected: false, connection: null };
    },
  });
}

export function useGoogleWorkspaceSync() {
  const qc = useQueryClient();
  const connectionQuery = useGoogleConnectionStatus();
  const syncNow = useGoogleSyncNow();
  const [liveRun, setLiveRun] = useState<import("@/lib/types").GoogleImportRun | null>(null);
  const [recentCompletion, setRecentCompletion] = useState<GoogleSyncStatus | null>(null);

  const connection = connectionQuery.data?.connection ?? null;
  const activeImport = liveRun ?? connectionQuery.data?.active_import ?? null;
  const latestImport = connectionQuery.data?.latest_import ?? null;
  const trackingRun = activeImport ?? latestImport;

  const canonicalStatus = useMemo<GoogleCanonicalImportStatus>(() => {
    if (connectionQuery.data?.canonical_status) {
      return connectionQuery.data.canonical_status;
    }
    return resolveCanonicalGoogleImportStatus({
      run: trackingRun,
      connectionError: connection?.last_sync_error,
    });
  }, [connectionQuery.data?.canonical_status, trackingRun, connection?.last_sync_error]);

  const syncStatus = useMemo(
    () => googleSyncStatusFromCanonical(canonicalStatus),
    [canonicalStatus],
  );

  const isActive = canonicalStatus.active;
  const isCoreSyncing = canonicalStatus.active && canonicalStatus.phase === "core_sync";

  useEffect(() => {
    const runId = trackingRun?.id;
    if (!runId || !isActive) return;

    return subscribeGoogleImportRun(runId, (run) => {
      setLiveRun(run);
      void connectionQuery.refetch();
    });
  }, [trackingRun?.id, isActive, connectionQuery]);

  useEffect(() => {
    if (!trackingRun?.id) {
      setLiveRun(null);
      return;
    }
    setLiveRun(trackingRun);
  }, [trackingRun?.id, trackingRun?.updated_at, trackingRun?.status, trackingRun?.progress_stage]);

  useEffect(() => {
    if (!isActive) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const poll = () => {
      if (document.visibilityState === "hidden") return;
      void connectionQuery.refetch();
    };

    poll();
    const timer = window.setInterval(poll, 12000);
    return () => window.clearInterval(timer);
  }, [isActive, connectionQuery]);

  const prevActiveRef = useRef(isActive);
  useEffect(() => {
    if (prevActiveRef.current && !isActive && trackingRun) {
      const completed = googleSyncStatusFromCanonical(
        resolveCanonicalGoogleImportStatus({ run: trackingRun }),
      );
      if (completed.stage === "completed" || completed.stage === "completed_with_warnings") {
        setRecentCompletion(completed);
        invalidateGoogleCrmData(qc);
      }
    }
    prevActiveRef.current = isActive;
  }, [isActive, trackingRun, qc]);

  useEffect(() => {
    if (!recentCompletion) return;
    const timer = window.setTimeout(() => setRecentCompletion(null), 12000);
    return () => window.clearInterval(timer);
  }, [recentCompletion]);

  const triggerSync = useCallback(async () => {
    const result = await syncNow.mutateAsync({});
    await connectionQuery.refetch();
    return result;
  }, [syncNow, connectionQuery]);

  return {
    connectionQuery,
    connected: connectionQuery.data?.connected === true,
    connection,
    syncStatus,
    canonicalStatus,
    recentCompletion,
    isSyncing: isCoreSyncing || syncNow.isPending,
    isEnrichmentActive: syncStatus.enrichmentActive,
    isCoreSyncing,
    triggerSync,
    syncNow,
    activeImport,
    dismissCompletion: () => setRecentCompletion(null),
    refetch: connectionQuery.refetch,
  };
}

export function useStartGoogleOAuth() {
  return useMutation({
    mutationFn: async (input?: { redirect_after?: string; enable_gmail?: boolean; incremental_gmail?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ auth_url: string }>("google-oauth-start", {
        body: input ?? {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.auth_url) throw new Error("No Google OAuth URL returned.");
      return data;
    },
  });
}

export function useDisconnectGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input?: { confirm?: boolean; remove_interactions?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ success: boolean }>("google-disconnect", {
        body: { confirm: true, ...input },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.googleConnection });
    },
  });
}

export function useGoogleSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input?: { sources?: string[]; calendar_only?: boolean; retry?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<GoogleSyncNowResponse>("google-sync-now", {
        body: input ?? {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data!;
    },
    onSuccess: () => {
      invalidateGoogleCrmData(qc);
    },
  });
}

const CALENDAR_FRESHNESS_MS = 15 * 60 * 1000;

export type GoogleCalendarRefreshResponse = {
  connected: boolean;
  calendar_enabled?: boolean;
  calendar_last_synced_at: string | null;
  is_stale: boolean;
  freshness_ms?: number;
  refresh_accepted: boolean;
  already_running?: boolean;
  trigger_run_id?: string;
  message?: string;
};

export function useGoogleCalendarRefreshMeta() {
  return useQuery({
    queryKey: [...qk.googleConnection, "calendar-freshness"],
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<GoogleCalendarRefreshResponse>("google-calendar-refresh", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data ?? { connected: false, calendar_last_synced_at: null, is_stale: false, refresh_accepted: false };
    },
  });
}

export function useGoogleCalendarRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input?: { manual?: boolean; force?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<GoogleCalendarRefreshResponse>("google-calendar-refresh", {
        body: input ?? {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.googleCalendarEvents });
      qc.invalidateQueries({ queryKey: [...qk.googleConnection, "calendar-freshness"] });
    },
  });
}

/** Calendar page: load cached events immediately; background refresh only when server says stale. */
export function useCalendarAutoRefresh() {
  const connectionQuery = useGoogleConnectionStatus();
  const freshnessQuery = useGoogleCalendarRefreshMeta();
  const calendarRefresh = useGoogleCalendarRefresh();
  const qc = useQueryClient();
  const attemptedRef = useRef(false);
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "error" | "done">("idle");
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const connected = connectionQuery.data?.connected === true;
  const calendarMeta = freshnessQuery.data;
  const isRefreshing = refreshState === "refreshing" || calendarRefresh.isPending || calendarMeta?.already_running === true;

  useEffect(() => {
    if (!connected || attemptedRef.current) return;
    if (freshnessQuery.isLoading) return;
    attemptedRef.current = true;

    if (!calendarMeta?.is_stale || calendarMeta?.already_running) return;

    setRefreshState("refreshing");
    void calendarRefresh
      .mutateAsync({})
      .then((result) => {
        if (result.refresh_accepted) {
          setRefreshState("done");
          void qc.invalidateQueries({ queryKey: qk.googleCalendarEvents });
          window.setTimeout(() => setRefreshState("idle"), 4000);
        } else {
          setRefreshState("idle");
        }
      })
      .catch((e: unknown) => {
        setRefreshState("error");
        setRefreshError(e instanceof Error ? e.message : "Calendar could not refresh");
      });
  }, [connected, calendarMeta?.is_stale, calendarMeta?.already_running, calendarRefresh, freshnessQuery.isLoading, qc]);

  useEffect(() => {
    if (!isRefreshing) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void freshnessQuery.refetch();
      void qc.invalidateQueries({ queryKey: qk.googleCalendarEvents });
    }, 12000);
    return () => window.clearInterval(timer);
  }, [isRefreshing, freshnessQuery, qc]);

  const retry = useCallback(() => {
    setRefreshState("refreshing");
    setRefreshError(null);
    void calendarRefresh
      .mutateAsync({ manual: true })
      .then((result) => {
        if (result.message && !result.refresh_accepted) {
          setRefreshState("idle");
          setRefreshError(result.message);
          return;
        }
        setRefreshState(result.refresh_accepted ? "done" : "idle");
        void qc.invalidateQueries({ queryKey: qk.googleCalendarEvents });
        window.setTimeout(() => setRefreshState("idle"), 4000);
      })
      .catch((e: unknown) => {
        setRefreshState("error");
        setRefreshError(e instanceof Error ? e.message : "Calendar could not refresh");
      });
  }, [calendarRefresh, qc]);

  return {
    refreshState,
    refreshError,
    isSyncing: isRefreshing,
    lastUpdatedAt: calendarMeta?.calendar_last_synced_at ?? connectionQuery.data?.connection?.calendar_last_synced_at ?? connectionQuery.data?.connection?.last_successful_sync_at ?? null,
    freshnessMs: calendarMeta?.freshness_ms ?? CALENDAR_FRESHNESS_MS,
    retry,
  };
}

export function useCrmImportCandidates(options?: { status?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: qk.crmImportCandidates(options?.status),
    enabled: options?.enabled !== false,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ candidates: import("@/lib/types").CrmEntityCandidate[] }>("crm-list-import-candidates", {
        body: { status: options?.status ?? "pending" },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data?.candidates ?? [];
    },
  });
}

export function useAcceptCrmCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { candidate_id: string; overrides?: Record<string, unknown> }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke("crm-accept-import-candidate", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.crmImportCandidates() });
      qc.invalidateQueries({ queryKey: qk.clients });
      qc.invalidateQueries({ queryKey: qk.contacts });
    },
  });
}

export function useIgnoreCrmCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { candidate_id: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke("crm-ignore-import-candidate", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.crmImportCandidates() });
    },
  });
}

export function useGoogleInteractions(companyId?: string) {
  return useQuery({
    queryKey: qk.googleInteractions(companyId),
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("google_interactions")
        .select("*")
        .eq("company_id", companyId!)
        .order("occurred_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").GoogleInteraction[];
    },
  });
}

export function useGoogleCalendarEvents() {
  return useQuery({
    queryKey: qk.googleCalendarEvents,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("provider", "google")
        .is("cancelled_at", null)
        .order("event_date", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export type ClickupSpaceOption = { id: string; name: string };

export function useClickupTeamSpaces(projectId: string, enabled = true): UseQueryResult<ClickupSpaceOption[]> {
  return useQuery({
    queryKey: qk.clickupTeamSpaces(projectId),
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ spaces: ClickupSpaceOption[] }>("clickup-list-spaces", {
        body: { project_id: projectId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data?.spaces ?? [];
    },
  });
}

export function useSlackWorkspaces(): UseQueryResult<SlackWorkspace[]> {
  return useQuery({
    queryKey: qk.slackWorkspaces,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_workspaces_safe")
        .select("*")
        .order("connected_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as SlackWorkspace[];
    },
  });
}

export function useStartSlackOAuth() {
  return useMutation({
    mutationFn: async (input?: { redirect_after?: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ auth_url: string }>("slack-oauth-start", {
        body: input ?? {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.auth_url) throw new Error("No Slack OAuth URL returned.");
      return data;
    },
  });
}

export function useDisconnectSlack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ disconnected: boolean }>("slack-disconnect", {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.slackWorkspaces });
    },
  });
}

export function useProjectSlackLinks(projectId: string): UseQueryResult<ProjectSlackLink[]> {
  return useQuery({
    queryKey: qk.projectSlackLinks(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_slack_links")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectSlackLink[];
    },
  });
}

export function useProjectSlackEvents(projectId: string): UseQueryResult<ProjectSlackEvent[]> {
  return useQuery({
    queryKey: qk.projectSlackEvents(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_slack_events")
        .select("*")
        .eq("project_id", projectId)
        .neq("signal_type", "noise")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectSlackEvent[];
    },
  });
}

export function useSlackListChannels() {
  return useMutation({
    mutationFn: async (input: {
      slack_team_id?: string;
      query?: string;
      include_private?: boolean;
      ensure_channel_ids?: string[];
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        channels: Array<{
          id: string;
          name: string;
          is_private: boolean;
          is_member: boolean;
          is_shared: boolean;
          is_ext_shared: boolean;
          suggested_link_type: "internal" | "external";
        }>;
      }>("slack-list-channels", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.channels) throw new Error("No Slack channels returned.");
      return data.channels;
    },
  });
}

export function useSlackLinkProjectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      slack_team_id: string;
      slack_channel_id: string;
      link_type: ProjectSlackLink["link_type"];
      link_label?: string;
      purpose?: string;
      include_in_ai?: boolean;
      include_in_client_updates?: boolean;
      is_client_facing?: boolean;
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ link: ProjectSlackLink }>(
        "slack-link-project-channel",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.link) throw new Error("No Slack link returned.");
      return data.link;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectSlackLinks(vars.project_id) });
    },
  });
}

function normalizeSlackSyncResult(data: Partial<SlackSyncProjectChannelResult>): SlackSyncProjectChannelResult {
  return {
    imported_count: data.imported_count ?? 0,
    thread_replies_imported_count: data.thread_replies_imported_count ?? 0,
    skipped_count: data.skipped_count ?? 0,
    events_upserted_count: data.events_upserted_count ?? 0,
    signals_upserted_count: data.signals_upserted_count ?? 0,
    meaningful_signals_count: data.meaningful_signals_count ?? 0,
    signal_threads_upserted_count: data.signal_threads_upserted_count ?? 0,
    jobs_queued_count: data.jobs_queued_count ?? 0,
    latest_messages_preview: Array.isArray(data.latest_messages_preview) ? data.latest_messages_preview : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    reprocessed: data.reprocessed,
  };
}

export function useSlackSyncProjectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      project_slack_link_id?: string;
      limit?: number;
      reprocess?: boolean;
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<Partial<SlackSyncProjectChannelResult>>(
        "slack-sync-project-channel",
        {
          body: input,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No Slack sync result returned.");
      return normalizeSlackSyncResult(data);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectSlackLinks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSlackEvents(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignals(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignalThreads(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProcessingJobs(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.slackPipelineDiagnostics(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.pmRecentSlackSignals });
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export function useReprocessSlackEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      project_slack_link_id?: string;
      force?: boolean;
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<ReprocessSlackEventsResult>(
        "reprocess-slack-events",
        {
          body: input,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No Slack reprocess result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectSlackEvents(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignals(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignalThreads(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProcessingJobs(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.slackPipelineDiagnostics(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.pmRecentSlackSignals });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

function buildSlackPipelineHints(args: {
  slackEventsCount: number;
  meaningfulSlackEventsCount: number;
  projectSignalsCount: number;
  queuedOrRunningJobsCount: number;
  latestJob: AiProcessingJob | null;
  latestSlackPmAction: ProjectPmActionItem | null;
}): string[] {
  const hints: string[] = [];
  if (args.slackEventsCount === 0) {
    hints.push("No Slack events imported yet — click Sync latest.");
  } else if (args.projectSignalsCount === 0) {
    hints.push("Slack events imported but no project_signals yet — click Reprocess Slack events.");
  } else if (args.meaningfulSlackEventsCount === 0) {
    hints.push("Slack events imported but none classified as meaningful (all noise or ignored).");
  } else if (args.queuedOrRunningJobsCount === 0 && !args.latestJob) {
    hints.push("Signals created but no processing job found — click Analyze latest updates.");
  } else if (args.latestJob?.status === "completed" && !args.latestSlackPmAction) {
    const result = args.latestJob.result;
    const skipReasons =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>).reasons
        : null;
    if (Array.isArray(skipReasons) && skipReasons.length > 0) {
      hints.push(`Job completed but no PM action was created: ${skipReasons.join(", ")}`);
    } else {
      hints.push("Job completed but no PM action was created (duplicate or deferred signal type).");
    }
  } else if (args.latestJob?.status === "failed") {
    hints.push(`Latest AI job failed: ${args.latestJob.error_message ?? "unknown error"}`);
  }
  return hints;
}

export function useProjectSlackPipelineDiagnostics(
  projectId: string,
  link?: Pick<ProjectSlackLink, "id" | "slack_channel_id" | "slack_team_id"> | null,
): UseQueryResult<SlackPipelineDiagnostics> {
  return useQuery({
    queryKey: qk.slackPipelineDiagnostics(projectId, link?.id),
    queryFn: async () => {
      let eventsQuery = supabase
        .from("project_slack_events")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (link?.id) eventsQuery = eventsQuery.eq("project_slack_link_id", link.id);

      let signalsQuery = supabase
        .from("project_signals")
        .select("*")
        .eq("project_id", projectId)
        .eq("source_type", "slack")
        .order("created_at", { ascending: false })
        .limit(10);
      if (link?.slack_channel_id) {
        signalsQuery = signalsQuery.filter(
          "metadata->>slack_channel_id",
          "eq",
          link.slack_channel_id,
        );
      }

      let threadsQuery = supabase
        .from("project_signal_threads")
        .select("*")
        .eq("project_id", projectId)
        .eq("source_type", "slack")
        .order("latest_signal_at", { ascending: false })
        .limit(5);
      if (link?.slack_team_id && link?.slack_channel_id) {
        threadsQuery = threadsQuery.like(
          "thread_key",
          `slack:${link.slack_team_id}:${link.slack_channel_id}:%`,
        );
      }

      const [
        { data: recentSlackEvents, error: eventsError },
        { data: recentSignals, error: signalsError },
        { data: recentThreads, error: threadsError },
        { data: recentJobs, error: jobsError },
        { count: slackEventsCount, error: eventsCountError },
        { count: meaningfulSlackEventsCount, error: meaningfulCountError },
        { count: projectSignalsCount, error: signalsCountError },
        { count: openSignalThreadsCount, error: openThreadsCountError },
        { count: queuedOrRunningJobsCount, error: queuedJobsCountError },
        { data: latestJob, error: latestJobError },
        { data: latestSlackPmAction, error: latestActionError },
      ] = await Promise.all([
        eventsQuery,
        signalsQuery,
        threadsQuery,
        supabase
          .from("ai_processing_jobs")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(5),
        (() => {
          let q = supabase
            .from("project_slack_events")
            .select("*", { count: "exact", head: true })
            .eq("project_id", projectId);
          if (link?.id) q = q.eq("project_slack_link_id", link.id);
          return q;
        })(),
        (() => {
          let q = supabase
            .from("project_slack_events")
            .select("*", { count: "exact", head: true })
            .eq("project_id", projectId)
            .neq("signal_type", "noise");
          if (link?.id) q = q.eq("project_slack_link_id", link.id);
          return q;
        })(),
        (() => {
          let q = supabase
            .from("project_signals")
            .select("*", { count: "exact", head: true })
            .eq("project_id", projectId)
            .eq("source_type", "slack");
          if (link?.slack_channel_id) {
            q = q.filter("metadata->>slack_channel_id", "eq", link.slack_channel_id);
          }
          return q;
        })(),
        (() => {
          let q = supabase
            .from("project_signal_threads")
            .select("*", { count: "exact", head: true })
            .eq("project_id", projectId)
            .eq("source_type", "slack")
            .eq("current_state", "open");
          if (link?.slack_team_id && link?.slack_channel_id) {
            q = q.like("thread_key", `slack:${link.slack_team_id}:${link.slack_channel_id}:%`);
          }
          return q;
        })(),
        supabase
          .from("ai_processing_jobs")
          .select("*", { count: "exact", head: true })
          .eq("project_id", projectId)
          .in("status", ["queued", "running"]),
        supabase
          .from("ai_processing_jobs")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("project_pm_action_items")
          .select("*")
          .eq("project_id", projectId)
          .eq("source", "slack")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const errors = [
        eventsError,
        signalsError,
        threadsError,
        jobsError,
        eventsCountError,
        meaningfulCountError,
        signalsCountError,
        openThreadsCountError,
        queuedJobsCountError,
        latestJobError,
        latestActionError,
      ].filter(Boolean);
      if (errors.length > 0) throw new Error(errors[0]!.message);

      const counts = {
        slackEventsCount: slackEventsCount ?? 0,
        meaningfulSlackEventsCount: meaningfulSlackEventsCount ?? 0,
        projectSignalsCount: projectSignalsCount ?? 0,
        openSignalThreadsCount: openSignalThreadsCount ?? 0,
        queuedOrRunningJobsCount: queuedOrRunningJobsCount ?? 0,
        latestJob: (latestJob ?? null) as AiProcessingJob | null,
        latestSlackPmAction: (latestSlackPmAction ?? null) as ProjectPmActionItem | null,
      };

      return {
        ...counts,
        hints: buildSlackPipelineHints(counts),
        recentSlackEvents: (recentSlackEvents ?? []) as ProjectSlackEvent[],
        recentSignals: (recentSignals ?? []) as ProjectSignal[],
        recentThreads: (recentThreads ?? []) as ProjectSignalThread[],
        recentJobs: (recentJobs ?? []) as AiProcessingJob[],
      };
    },
    enabled: !!projectId,
  });
}

export function useProcessAiJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; limit?: number; ensure_pending?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<ProcessAiJobsResult>("process-ai-jobs", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No AI job processing result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.aiProcessingJobs(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignals(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignalThreads(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.slackPipelineDiagnostics(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export function useUpdateProjectSlackLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      project_id,
      patch,
    }: {
      id: string;
      project_id: string;
      patch: Partial<ProjectSlackLink>;
    }) => {
      const { error } = await supabase.from("project_slack_links").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectSlackLinks(vars.project_id) });
    },
  });
}

export function usePmRecentSlackSignals(): UseQueryResult<
  Array<ProjectSlackEvent & { project_name: string; channel_name: string | null }>
> {
  return useQuery({
    queryKey: qk.pmRecentSlackSignals,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_slack_events")
        .select("*, projects!inner(name, is_draft), project_slack_links(channel_name)")
        .neq("signal_type", "noise")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .filter((row) => !(row.projects as { is_draft?: boolean })?.is_draft)
        .map((row) => {
          const record = row as ProjectSlackEvent & {
            projects: { name: string; is_draft?: boolean };
            project_slack_links: { channel_name: string | null } | null;
          };
          const { projects, project_slack_links, ...event } = record;
          return {
            ...event,
            project_name: projects.name,
            channel_name: project_slack_links?.channel_name ?? null,
          };
        });
    },
  });
}

export function useEnsureProjectClickupSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; clickup_space_id?: string; space_name?: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ link: ProjectClickupLink; created: boolean }>(
        "clickup-ensure-project-space",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No ClickUp link returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectClickupLink(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupTimeline(vars.project_id) });
    },
  });
}

export type CreateClickupTaskResult = {
  project_clickup_link: ProjectClickupLink | null;
  clickup_task_link: ClickupTaskLink;
  ai_proposed_task: AiProposedTask;
  already_created?: boolean;
  message?: string;
  warnings?: string[];
};

export type CreateClickupTaskFromPmActionResult = {
  pm_action_item: ProjectPmActionItem;
  clickup_task_link: ClickupTaskLink;
  already_created?: boolean;
  message?: string;
  warnings?: string[];
};

export function useCreateClickupTaskFromAiProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ai_proposed_task_id: string;
      project_id: string;
      title?: string;
      description?: string;
      priority?: AiProposedTaskPriority | "";
      status?: string;
      assignee_ids?: string[];
      start_date?: string;
      due_date?: string;
      time_estimate_minutes?: number;
      tag_names?: string[];
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<CreateClickupTaskResult>(
        "clickup-create-task-from-ai-proposal",
        {
          body: {
            ai_proposed_task_id: input.ai_proposed_task_id,
            title: input.title,
            description: input.description,
            priority: input.priority,
            status: input.status,
            assignee_ids: input.assignee_ids ?? [],
            start_date: input.start_date,
            due_date: input.due_date,
            time_estimate_minutes: input.time_estimate_minutes,
            tag_names: input.tag_names ?? [],
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No ClickUp task result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupTaskLinks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupTimeline(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupLink(vars.project_id) });
    },
  });
}

export function useCreateClickupTaskFromPmAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pm_action_item_id: string;
      project_id: string;
      title?: string;
      description?: string;
      priority?: AiProposedTaskPriority | "";
      status?: string;
      assignee_ids?: string[];
      start_date?: string;
      due_date?: string;
      time_estimate_minutes?: number;
      tag_names?: string[];
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<CreateClickupTaskFromPmActionResult>(
        "clickup-create-task-from-pm-action",
        {
          body: {
            pm_action_item_id: input.pm_action_item_id,
            title: input.title,
            description: input.description,
            priority: input.priority,
            status: input.status,
            assignee_ids: input.assignee_ids ?? [],
            start_date: input.start_date,
            due_date: input.due_date,
            time_estimate_minutes: input.time_estimate_minutes,
            tag_names: input.tag_names ?? [],
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No ClickUp task result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupTaskLinks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupTimeline(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupLink(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export type ClickupSetupUpdatePlan = {
  will_update: string[];
  will_not_change: string[];
  cannot_change_automatically: string[];
  manual_steps: string[];
  will_update_automatically?: string[];
  requires_manual_configuration?: string[];
  will_remain_unchanged?: string[];
};

export type ClickupSetupUpdateResult = {
  status: "succeeded" | "partial" | "failed" | "skipped";
  enabled_automatically: string[];
  requires_manual: string[];
  unchanged: string[];
  warnings: string[];
  diagnostic_code?: string;
};

export type ClickupSetupAuditResponse = {
  audit: {
    status: string;
    template_version: number;
    applied_template_version: number | null;
    template_name: string;
    capabilities: ClickupSetupCapabilitySnapshot;
    warnings: string[];
    manual_steps: string[];
    space: { exists: boolean; id?: string; name?: string };
    folder: { exists: boolean; id?: string; name?: string };
    list: { exists: boolean; id?: string; name?: string };
  };
  update_plan: ClickupSetupUpdatePlan;
  diagnostics_summary: string;
  link: ProjectClickupLink;
};

export function useAuditClickupProjectSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<ClickupSetupAuditResponse>(
        "clickup-audit-project-setup",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No ClickUp audit result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectClickupLink(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupListStatuses(vars.project_id) });
      qc.invalidateQueries({ queryKey: [...qk.projectClickupLink(vars.project_id), "diagnostics"] });
    },
  });
}

export function useSyncClickupProjectSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; confirm: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        audit: ClickupSetupAuditResponse["audit"];
        plan: ClickupSetupUpdatePlan;
        applied_changes: string[];
        diagnostics_summary: string;
        already_applied?: boolean;
        update_result?: ClickupSetupUpdateResult;
      }>(
        "clickup-sync-project-setup",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No ClickUp setup sync result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectClickupLink(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupListStatuses(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupAssignableMembers(vars.project_id) });
      qc.invalidateQueries({ queryKey: [...qk.projectClickupLink(vars.project_id), "diagnostics"] });
    },
  });
}

export function useClickupMembers(teamId: string | undefined): UseQueryResult<ClickupMember[]> {
  return useQuery({
    queryKey: qk.clickupMembers(teamId ?? ""),
    enabled: !!teamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clickup_members")
        .select("*")
        .eq("clickup_team_id", teamId!)
        .eq("is_active", true)
        .order("username");
      return unwrap<ClickupMember[]>(data, error);
    },
  });
}

export function useClickupAssignableMembers(
  projectId: string | undefined,
): UseQueryResult<ProjectClickupAssignableMember[]> {
  return useQuery({
    queryKey: qk.clickupAssignableMembers(projectId ?? ""),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_clickup_assignable_members")
        .select("*")
        .eq("project_id", projectId!)
        .eq("is_assignable", true)
        .order("name");
      return unwrap<ProjectClickupAssignableMember[]>(data, error);
    },
  });
}

export interface ClickupListStatusOption {
  status: string;
  type?: string;
  orderindex?: number;
  color?: string;
}

export interface ClickupPriorityOption {
  value: AiProposedTaskPriority | "";
  label: string;
  clickup_value: number | null;
}

export interface ClickupSetupCapabilitySnapshot {
  statuses: { available: boolean; missing: string[]; present?: string[] };
  assignees: { available: boolean; member_count: number; multiple_assignees: boolean };
  start_date: { available: boolean; manual_step?: string };
  due_date: { available: boolean };
  priority: { available: boolean };
  time_estimate: { available: boolean; manual_step?: string };
  time_tracking: { available: boolean; manual_step?: string };
  tags: { available: boolean; manual_step?: string };
}

export interface ClickupListStatusesResult {
  linked: boolean;
  statuses: ClickupListStatusOption[];
  default_status?: string | null;
  priorities: ClickupPriorityOption[];
  tags: string[];
  capabilities: ClickupSetupCapabilitySnapshot | null;
  setup: {
    status: string;
    template_version: number;
    applied_template_version: number | null;
    warnings: string[];
    manual_steps: string[];
  } | null;
  destination: {
    list_id: string;
    list_name: string | null;
    folder_name: string | null;
    space_name: string | null;
  } | null;
  message?: string;
}

export function useClickupListStatuses(
  projectId: string | undefined,
  enabled = true,
): UseQueryResult<ClickupListStatusesResult> {
  return useQuery({
    queryKey: qk.clickupListStatuses(projectId ?? ""),
    enabled: !!projectId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<ClickupListStatusesResult>(
        "clickup-list-statuses",
        { body: { project_id: projectId }, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No ClickUp statuses returned.");
      return data;
    },
  });
}

export function useSyncClickupMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id?: string; force?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        members: ClickupMember[];
        assignable_members: ProjectClickupAssignableMember[];
        synced_count: number;
        assignable_synced_count: number;
        source: string;
        assignable_source: string;
        diagnostics: ClickupAssignableMembersSyncDiagnostics | null;
      }>(
        "clickup-sync-members",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No member sync result returned.");
      return data;
    },
    onSuccess: (data, input) => {
      const teamId = data.members[0]?.clickup_team_id;
      if (teamId) qc.invalidateQueries({ queryKey: qk.clickupMembers(teamId) });
      if (input.project_id) {
        qc.invalidateQueries({ queryKey: qk.clickupAssignableMembers(input.project_id) });
        qc.invalidateQueries({ queryKey: qk.projectClickupLink(input.project_id) });
      }
    },
  });
}

// --------------------------------------------------------------------------
// Project Control Center
// --------------------------------------------------------------------------
export function useProjectAiStatusReports(projectId: string): UseQueryResult<ProjectAiStatusReport[]> {
  return useQuery({
    queryKey: qk.projectAiStatusReports(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_ai_status_reports")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      return unwrap<ProjectAiStatusReport[]>(data, error);
    },
  });
}

export function useLatestProjectAiStatusReport(projectId: string): UseQueryResult<ProjectAiStatusReport | null> {
  return useQuery({
    queryKey: [...qk.projectAiStatusReports(projectId), "latest"],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_ai_status_reports")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as ProjectAiStatusReport | null;
    },
  });
}

export function useProjectPmActionItems(projectId: string): UseQueryResult<ProjectPmActionItem[]> {
  return useQuery({
    queryKey: qk.projectPmActionItems(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_pm_action_items")
        .select("*")
        .eq("project_id", projectId)
        .order("status", { ascending: true })
        .order("created_at", { ascending: false });
      return unwrap<ProjectPmActionItem[]>(data, error);
    },
  });
}

export function useSyncProjectClickupUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        imported_events_count: number;
        checked_tasks_count: number;
        comments_imported_count: number;
      }>("clickup-sync-project-updates", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No ClickUp sync result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectClickupTimeline(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupLink(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupTaskLinks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectAiStatusReports(vars.project_id) });
      qc.invalidateQueries({ queryKey: [...qk.projectClickupLink(vars.project_id), "diagnostics"] });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export type ClickupDiagnostics = {
  lastTimelineEvent: ProjectClickupTimelineEvent | null;
  lastWebhookEvent: {
    id: string;
    event_type: string | null;
    clickup_task_id: string | null;
    created_at: string;
    processing_error: string | null;
  } | null;
  workspaceMemberCount: number;
  assignableMemberCount: number;
  hiddenWorkspaceMemberCount: number;
  assignableMembersSync: ClickupAssignableMembersSyncDiagnostics | null;
};

export function useClickupDiagnostics(projectId: string): UseQueryResult<ClickupDiagnostics> {
  return useQuery({
    queryKey: [...qk.projectClickupLink(projectId), "diagnostics"],
    enabled: !!projectId,
    queryFn: async () => {
      const { data: link } = await supabase
        .from("project_clickup_links")
        .select("metadata, clickup_team_id")
        .eq("project_id", projectId)
        .maybeSingle();

      const teamId = link?.clickup_team_id ?? null;
      let workspaceMemberCount = 0;
      if (teamId) {
        const { count } = await supabase
          .from("clickup_members")
          .select("id", { count: "exact", head: true })
          .eq("clickup_team_id", teamId)
          .eq("is_active", true);
        workspaceMemberCount = count ?? 0;
      }

      const { count: assignableMemberCount } = await supabase
        .from("project_clickup_assignable_members")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("is_assignable", true);

      const metadata =
        link?.metadata && typeof link.metadata === "object" && !Array.isArray(link.metadata)
          ? (link.metadata as Record<string, unknown>)
          : null;
      const assignableMembersSync =
        metadata?.assignable_members_sync &&
        typeof metadata.assignable_members_sync === "object" &&
        !Array.isArray(metadata.assignable_members_sync)
          ? (metadata.assignable_members_sync as ClickupAssignableMembersSyncDiagnostics)
          : null;

      const { data: taskLinks } = await supabase
        .from("clickup_task_links")
        .select("clickup_task_id")
        .eq("project_id", projectId);
      const taskIds = (taskLinks ?? []).map((row) => row.clickup_task_id).filter(Boolean);

      const { data: lastTimelineEvent, error: timelineError } = await supabase
        .from("project_clickup_timeline_events")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (timelineError) throw new Error(timelineError.message);

      let lastWebhookEvent: ClickupDiagnostics["lastWebhookEvent"] = null;
      if (taskIds.length > 0) {
        const { data: webhook, error: webhookError } = await supabase
          .from("clickup_webhook_events")
          .select("id, event_type, clickup_task_id, created_at, processing_error")
          .in("clickup_task_id", taskIds)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (webhookError) throw new Error(webhookError.message);
        lastWebhookEvent = webhook;
      }

      const assignableCount = assignableMemberCount ?? 0;
      return {
        lastTimelineEvent: (lastTimelineEvent ?? null) as ProjectClickupTimelineEvent | null,
        lastWebhookEvent,
        workspaceMemberCount,
        assignableMemberCount: assignableCount,
        hiddenWorkspaceMemberCount: Math.max(0, workspaceMemberCount - assignableCount),
        assignableMembersSync,
      };
    },
  });
}

export type GenerateProjectStatusReportResult = {
  report: ProjectAiStatusReport;
  action_items: ProjectPmActionItem[];
  clickup_sync?: {
    skipped: boolean;
    skip_reason?: string;
    imported_events_count: number;
    checked_tasks_count: number;
    comments_imported_count: number;
  } | null;
  slack_pipeline?: ProcessAiJobsResult | null;
};

export function useGenerateProjectStatusReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      since?: string;
      report_type?: ProjectAiStatusReport["report_type"];
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<GenerateProjectStatusReportResult>(
        "generate-project-status-report",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No project status report was returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectAiStatusReports(vars.project_id) });
      qc.invalidateQueries({ queryKey: [...qk.projectAiStatusReports(vars.project_id), "latest"] });
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupTimeline(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupTaskLinks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: [...qk.projects, vars.project_id] });
      qc.invalidateQueries({ queryKey: qk.projectClickupLink(vars.project_id) });
      qc.invalidateQueries({ queryKey: [...qk.projectClickupLink(vars.project_id), "diagnostics"] });
      qc.invalidateQueries({ queryKey: qk.projectSlackEvents(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignals(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectSignalThreads(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProcessingJobs(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.slackPipelineDiagnostics(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export function useUpdateProjectPmActionItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      project_id,
      status,
      dismiss_reason,
    }: {
      id: string;
      project_id: string;
      status: ProjectPmActionItem["status"];
      dismiss_reason?: string | null;
    }) => {
      const now = new Date().toISOString();
      const patch: Partial<ProjectPmActionItem> = {
        status,
        completed_at: status === "done" || status === "dismissed" ? now : null,
      };

      if (status === "dismissed") {
        const { data: auth } = await supabase.auth.getUser();
        patch.dismissed_at = now;
        patch.dismissed_by = auth.user?.id ?? null;
        patch.dismiss_reason = dismiss_reason?.trim() || null;
        patch.resolution_source = "dismissed";
      }

      if (status === "open") {
        patch.dismissed_at = null;
        patch.dismissed_by = null;
        patch.dismiss_reason = null;
        patch.resolution_source = null;
        patch.completed_at = null;
      }

      const { error } = await supabase.from("project_pm_action_items").update(patch).eq("id", id);
      if (error) {
        const schemaCacheMiss =
          /schema cache|could not find the .* column/i.test(error.message) &&
          (status === "dismissed" || status === "open");
        if (schemaCacheMiss) {
          const minimal: Partial<ProjectPmActionItem> = {
            status,
            completed_at: status === "dismissed" ? now : null,
          };
          const { error: retryError } = await supabase
            .from("project_pm_action_items")
            .update(minimal)
            .eq("id", id);
          if (retryError) throw new Error(retryError.message);
          return;
        }
        throw new Error(error.message);
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.pmOpenActionItems });
      qc.invalidateQueries({ queryKey: qk.pmProjectsNeedingAttention });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export type ExecutePmActionInput = {
  action_item_id: string;
  project_id: string;
  execution_payload?: {
    assignee_ids?: string[];
    due_date?: string;
    due_date_time?: boolean;
    comment_text?: string;
    selected_clickup_task_ids?: string[];
    selected_ai_proposed_task_ids?: string[];
    resolve_blocker?: boolean;
    resolution_note?: string;
  };
  retry?: boolean;
};

export type ExecutePmActionResult = {
  execution: ProjectPmActionExecution;
  action_item_id: string;
  status: string;
  copy_text?: string;
};

export function useExecutePmAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExecutePmActionInput) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<ExecutePmActionResult>("execute-pm-action", {
        body: {
          action_item_id: input.action_item_id,
          execution_payload: input.execution_payload,
          retry: input.retry,
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No PM action execution result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectClickupTimeline(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.clickupTaskLinks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectAiStatusReports(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export function useDedupePmActionItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; dry_run?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        duplicates_found: number;
        items_merged: number;
        canonical_ids: string[];
        dismissed_ids: string[];
        dry_run: boolean;
      }>("dedupe-pm-actions", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No dedupe result returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.projectPmActionItems(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.slackPipelineDiagnostics(vars.project_id) });
    },
  });
}

// --------------------------------------------------------------------------
// PM Command Center (cross-project)
// --------------------------------------------------------------------------

const PM_ACTION_SELECT =
  "id, project_id, title, description, category, priority, status, action_type, action_payload, execution_status, completed_at, created_at, updated_at, action_key, blocker_type, blocker_resource, blocked_actor_name, blocked_actor_email, related_clickup_task_ids, related_clickup_task_titles, signal_count, first_signal_at, latest_signal_at, last_signal_summary, resolution_note, resolution_source, auto_resolved_by_event_id, auto_resolved_reason, source_event_ids, status_report_id, due_date, source, execution_result, execution_error, executed_at, created_by";

export function usePmOpenActionItems(): UseQueryResult<PmOpenActionItem[]> {
  return useQuery({
    queryKey: qk.pmOpenActionItems,
    queryFn: async () => {
      const { isOpenPmAction, sortOpenPmActions } = await import("@/lib/pmActions");
      const { data, error } = await supabase
        .from("project_pm_action_items")
        .select(`${PM_ACTION_SELECT}, projects!inner(name, is_draft)`)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const items = (data ?? [])
        .map((row) => {
          const projects = (row as Record<string, unknown>).projects as { name?: string; is_draft?: boolean } | null;
          if (projects?.is_draft) return null;
          const { projects: _p, ...rest } = row as Record<string, unknown>;
          const item = rest as unknown as ProjectPmActionItem;
          if (!isOpenPmAction(item)) return null;
          return { ...item, project_name: projects?.name ?? "Unknown project" } satisfies PmOpenActionItem;
        })
        .filter((item): item is PmOpenActionItem => item !== null);
      return sortOpenPmActions(items);
    },
  });
}

export function usePmProjectsNeedingAttention(): UseQueryResult<PmProjectAttention[]> {
  return useQuery({
    queryKey: qk.pmProjectsNeedingAttention,
    queryFn: async () => {
      const { isOpenPmAction } = await import("@/lib/pmActions");
      const [
        { data: projects, error: projectsError },
        { data: actions, error: actionsError },
        { data: links, error: linksError },
        { data: timeline, error: timelineError },
        { data: reports, error: reportsError },
      ] = await Promise.all([
        supabase.from("projects").select("id, name, health, risk, status, is_draft, archived_at").eq("is_draft", false).is("archived_at", null),
        supabase.from("project_pm_action_items").select(`${PM_ACTION_SELECT}`).limit(500),
        supabase.from("project_clickup_links").select("project_id, metadata").eq("status", "active"),
        supabase
          .from("project_clickup_timeline_events")
          .select("project_id, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("project_ai_status_reports")
          .select("project_id, created_at")
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (projectsError) throw new Error(projectsError.message);
      if (actionsError) throw new Error(actionsError.message);
      if (linksError) throw new Error(linksError.message);
      if (timelineError) throw new Error(timelineError.message);
      if (reportsError) throw new Error(reportsError.message);

      const openByProject = new Map<string, ProjectPmActionItem[]>();
      for (const row of actions ?? []) {
        const item = row as ProjectPmActionItem;
        if (!isOpenPmAction(item)) continue;
        const list = openByProject.get(item.project_id) ?? [];
        list.push(item);
        openByProject.set(item.project_id, list);
      }

      const needsReviewByProject = new Map<string, boolean>();
      for (const link of links ?? []) {
        const metadata = link.metadata as Record<string, unknown> | null;
        needsReviewByProject.set(
          link.project_id,
          metadata != null && !Array.isArray(metadata) && metadata.needs_ai_review === true,
        );
      }

      const latestEventByProject = new Map<string, string>();
      for (const event of timeline ?? []) {
        if (!latestEventByProject.has(event.project_id)) {
          latestEventByProject.set(event.project_id, event.created_at);
        }
      }

      const latestReportByProject = new Map<string, string>();
      for (const report of reports ?? []) {
        if (!latestReportByProject.has(report.project_id)) {
          latestReportByProject.set(report.project_id, report.created_at);
        }
      }

      const attention: PmProjectAttention[] = [];
      for (const project of projects ?? []) {
        const open = openByProject.get(project.id) ?? [];
        const urgent = open.filter((a) => a.priority === "urgent").length;
        const high = open.filter((a) => a.priority === "high").length;
        const clientQuestions = open.filter(
          (a) => a.category === "client_question" || a.action_type === "ask_client_question",
        ).length;
        const needsReview = needsReviewByProject.get(project.id) ?? false;
        const healthRisk =
          project.health === "at-risk" ||
          project.health === "off-track" ||
          project.risk === "medium" ||
          project.risk === "high";
        const hasBlockers = open.some((a) => a.blocker_type || a.category === "access_needed");
        const latestActionAt =
          open.length > 0
            ? open
                .map((a) => a.latest_signal_at ?? a.updated_at ?? a.created_at)
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
            : null;

        const needsAttention =
          healthRisk ||
          urgent > 0 ||
          high > 0 ||
          needsReview ||
          hasBlockers ||
          clientQuestions > 0;

        if (!needsAttention) continue;

        attention.push({
          project_id: project.id,
          project_name: project.name,
          health: project.health,
          risk: project.risk,
          status: project.status,
          open_action_count: open.length,
          urgent_action_count: urgent,
          high_action_count: high,
          client_question_count: clientQuestions,
          latest_action_at: latestActionAt,
          latest_clickup_event_at: latestEventByProject.get(project.id) ?? null,
          needs_ai_review: needsReview,
          last_status_report_at: latestReportByProject.get(project.id) ?? null,
        });
      }

      attention.sort((a, b) => {
        if (a.needs_ai_review !== b.needs_ai_review) return a.needs_ai_review ? -1 : 1;
        if (a.urgent_action_count !== b.urgent_action_count) return b.urgent_action_count - a.urgent_action_count;
        if (a.high_action_count !== b.high_action_count) return b.high_action_count - a.high_action_count;
        const healthRank = (h: string) => (h === "off-track" ? 2 : h === "at-risk" ? 1 : 0);
        const hr = healthRank(b.health) - healthRank(a.health);
        if (hr !== 0) return hr;
        return b.open_action_count - a.open_action_count;
      });

      return attention;
    },
  });
}

export function usePmRecentClickupActivity(): UseQueryResult<PmRecentClickupActivity[]> {
  return useQuery({
    queryKey: qk.pmRecentClickupActivity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_clickup_timeline_events")
        .select("*, projects!inner(name, is_draft)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);

      const taskIds = [...new Set((data ?? []).map((e) => e.clickup_task_id).filter(Boolean))] as string[];
      let taskNameById = new Map<string, string>();
      if (taskIds.length > 0) {
        const { data: taskLinks } = await supabase
          .from("clickup_task_links")
          .select("clickup_task_id, clickup_task_name")
          .in("clickup_task_id", taskIds);
        taskNameById = new Map(
          (taskLinks ?? [])
            .filter((t) => t.clickup_task_id)
            .map((t) => [t.clickup_task_id, t.clickup_task_name ?? t.clickup_task_id]),
        );
      }

      return (data ?? [])
        .filter((row) => {
          const projects = row.projects as { is_draft?: boolean } | null;
          return !projects?.is_draft;
        })
        .map((row) => {
          const { projects, ...event } = row;
          const project = projects as { name?: string } | null;
          return {
            ...(event as ProjectClickupTimelineEvent),
            project_name: project?.name ?? "Unknown project",
            task_name: event.clickup_task_id ? taskNameById.get(event.clickup_task_id) ?? null : null,
          } satisfies PmRecentClickupActivity;
        });
    },
  });
}

export function usePmStaleClickupTasks(): UseQueryResult<PmStaleClickupTask[]> {
  return useQuery({
    queryKey: qk.pmStaleClickupTasks,
    queryFn: async () => {
      const { isClickupTaskClosed } = await import("@/lib/pmActions");
      const staleDays = 5;
      const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

      const { data, error } = await supabase
        .from("clickup_task_links")
        .select("*, projects!inner(name, is_draft, status)")
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(200);
      if (error) throw new Error(error.message);

      const stale: PmStaleClickupTask[] = [];
      for (const row of data ?? []) {
        const project = row.projects as { name?: string; is_draft?: boolean; status?: string } | null;
        if (project?.is_draft || project?.status === "completed") continue;
        if (isClickupTaskClosed(row.clickup_status)) continue;

        const lastSynced = row.last_synced_at ? new Date(row.last_synced_at).getTime() : 0;
        const daysQuiet = lastSynced ? Math.floor((Date.now() - lastSynced) / (24 * 60 * 60 * 1000)) : staleDays + 1;

        let dueDate: string | null = null;
        let overdue = false;
        if (row.last_snapshot && typeof row.last_snapshot === "object" && !Array.isArray(row.last_snapshot)) {
          const snapshot = row.last_snapshot as Record<string, unknown>;
          const due = snapshot.due_date;
          if (typeof due === "number" && due > 0) {
            dueDate = new Date(due).toISOString().slice(0, 10);
            overdue = due < Date.now();
          } else if (typeof due === "string" && due) {
            dueDate = due.slice(0, 10);
            overdue = new Date(due).getTime() < Date.now();
          }
        }

        const isQuiet = !row.last_synced_at || lastSynced < cutoff;
        if (!isQuiet && !overdue) continue;

        stale.push({
          project_id: row.project_id,
          project_name: project?.name ?? "Unknown project",
          clickup_task_id: row.clickup_task_id,
          task_name: row.clickup_task_name,
          task_url: row.clickup_task_url,
          status: row.clickup_status,
          due_date: dueDate,
          last_synced_at: row.last_synced_at,
          days_quiet: daysQuiet,
        });
      }

      stale.sort((a, b) => {
        if (a.due_date && b.due_date) {
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        }
        return b.days_quiet - a.days_quiet;
      });

      return stale.slice(0, 15);
    },
  });
}

export function useLatestPmDailyPlan(): UseQueryResult<PmDailyPlan | null> {
  return useQuery({
    queryKey: qk.latestPmDailyPlan,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;
      let query = supabase
        .from("pm_daily_plans")
        .select("*")
        .eq("plan_date", today)
        .order("created_at", { ascending: false })
        .limit(1);
      if (userId) query = query.eq("created_by", userId);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        ...data,
        project_focus: Array.isArray(data.project_focus) ? data.project_focus : [],
      } as PmDailyPlan;
    },
  });
}

export function useGeneratePmDailyPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input?: { date?: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ plan: PmDailyPlan }>("generate-pm-daily-plan", {
        body: input ?? {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.plan) throw new Error("No PM daily plan was returned.");
      return data.plan;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.pmDailyPlans });
      qc.invalidateQueries({ queryKey: qk.latestPmDailyPlan });
    },
  });
}

// Remove unused import warning suppression
export type { TaskPriority };

// --------------------------------------------------------------------------
// CRM — company_people relationships
// --------------------------------------------------------------------------
export function useCompanyPeople(companyId?: string) {
  return useQuery({
    queryKey: qk.companyPeople(companyId),
    queryFn: async () => {
      let query = supabase.from("company_people").select("*, contacts(*)");
      if (companyId) query = query.eq("company_id", companyId);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<import("@/lib/types").CompanyPerson & { contacts: import("@/lib/types").Contact | null }>;
    },
  });
}

export function useCreateCompanyPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      company_id: string;
      person_id: string;
      relationship_type: import("@/lib/types").CompanyPersonRelationship;
      is_primary?: boolean;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.from("company_people").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.companyPeople(vars.company_id) });
      qc.invalidateQueries({ queryKey: qk.companyPeople() });
      qc.invalidateQueries({ queryKey: qk.contacts });
    },
  });
}

// --------------------------------------------------------------------------
// Team member rates
// --------------------------------------------------------------------------
const TEAM_MEMBER_RATE_SELECT = `
  *,
  team_member_rate_projects(
    project_id,
    projects(id, name, archived_at)
  )
`;

async function enrichTeamMemberRate(
  rate: import("@/lib/types").TeamMemberRate,
): Promise<import("@/lib/types").TeamMemberRate> {
  const { data, error } = await supabase
    .from("team_member_rates")
    .select(TEAM_MEMBER_RATE_SELECT)
    .eq("id", rate.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const { mapTeamMemberRateRow } = await import("@/lib/teamMemberRates");
  if (data) return mapTeamMemberRateRow(data as Record<string, unknown>);
  return mapTeamMemberRateRow(rate as unknown as Record<string, unknown>);
}

export function useTeamMemberRates(personId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.teamMemberRates(personId),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_member_rates")
        .select(TEAM_MEMBER_RATE_SELECT)
        .eq("person_id", personId)
        .order("effective_from", { ascending: false });
      if (error) throw new Error(error.message);
      const { mapTeamMemberRateRow } = await import("@/lib/teamMemberRates");
      return (data ?? []).map((row) => mapTeamMemberRateRow(row as Record<string, unknown>));
    },
  });
}

export function useResolveTeamMemberRate(
  personId: string,
  options?: {
    enabled?: boolean;
    projectId?: string | null;
    workType?: string | null;
    effectiveDate?: string;
  },
) {
  return useQuery({
    queryKey: qk.resolveTeamMemberRate(personId, options?.projectId ?? undefined, options?.workType ?? undefined),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<import("@/lib/types").ResolveTeamMemberRateResult>(
        "resolve-team-member-rate",
        {
          body: {
            person_id: personId,
            project_id: options?.projectId ?? null,
            work_type: options?.workType ?? null,
            effective_date: options?.effectiveDate,
          },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      return data!;
    },
  });
}

export function useRateUsageCheck(rateId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.rateUsage(rateId),
    enabled: (options?.enabled ?? true) && !!rateId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("team_member_rate_is_used", {
        p_rate_id: rateId,
      });
      if (!error) return { is_used: !!data };
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke<{ is_used: boolean }>(
        "team-member-rates",
        { body: { action: "check_usage", rate_id: rateId } },
      );
      if (edgeErr) await throwEdgeFunctionError(edgeErr);
      return edgeData!;
    },
  });
}

export function useTeamFinancialSummary(
  personId: string,
  period: "mtd" | "ytd" | "lifetime" = "mtd",
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: qk.teamFinancialSummary(personId, period),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        period: string;
        paid: import("@/lib/types").EurReportingAggregate;
        outstanding_invoices: import("@/lib/types").EurReportingAggregate;
      }>("team-financial-summary", {
        body: { person_id: personId, period },
      });
      if (error) await throwEdgeFunctionError(error);
      return data!;
    },
  });
}

type ManageRateInput = {
  action: "create" | "update" | "end" | "replace" | "set_default" | "delete";
  person_id: string;
  rate_id?: string;
  name?: string;
  description?: string | null;
  rate_type?: import("@/lib/types").RateType;
  amount?: number;
  currency?: string;
  /** @deprecated Use project_ids */
  project_id?: string | null;
  project_ids?: string[];
  work_type?: string | null;
  is_default?: boolean;
  effective_from?: string;
  effective_to?: string | null;
  notes?: string | null;
  allow_used?: boolean;
};

function formatRateConflictMessage(error: Error): string {
  const parsed = error.message.match(/RATE_CONFLICT:(.+)/);
  if (!parsed?.[1]) return error.message;
  try {
    const payload = JSON.parse(parsed[1]) as import("@/lib/types").TeamMemberRateConflictResult;
    const lines = payload.conflicts
      .filter((c) => c.project_name)
      .map((c) => `- ${c.project_name}`);
    if (lines.length) {
      return `This rate conflicts with an existing active rate for:\n${lines.join("\n")}`;
    }
  } catch {
    /* fall through */
  }
  return error.message;
}

async function manageRateViaRpc(input: ManageRateInput) {
  switch (input.action) {
    case "create": {
      const { data, error } = await supabase.rpc("create_team_member_rate", {
        p_person_id: input.person_id,
        p_name: input.name ?? "Rate",
        p_rate_type: input.rate_type,
        p_amount: input.amount,
        p_currency: input.currency ?? "EUR",
        p_project_id: null,
        p_work_type: input.work_type ?? null,
        p_is_default: input.is_default ?? false,
        p_effective_from: input.effective_from ?? new Date().toISOString().slice(0, 10),
        p_effective_to: input.effective_to ?? null,
        p_description: input.description ?? null,
        p_notes: input.notes ?? null,
        p_project_ids: input.project_ids?.length ? input.project_ids : null,
      });
      if (error) throw new Error(formatRateConflictMessage(new Error(error.message)));
      const rate = await enrichTeamMemberRate(data as import("@/lib/types").TeamMemberRate);
      return { rate };
    }
    case "update": {
      const { data, error } = await supabase.rpc("update_team_member_rate", {
        p_rate_id: input.rate_id,
        p_name: input.name ?? null,
        p_description: input.description ?? null,
        p_rate_type: input.rate_type ?? null,
        p_amount: input.amount ?? null,
        p_currency: input.currency ?? null,
        p_project_id: null,
        p_work_type: input.work_type ?? null,
        p_is_default: input.is_default ?? null,
        p_effective_from: input.effective_from ?? null,
        p_effective_to: input.effective_to ?? null,
        p_notes: input.notes ?? null,
        p_allow_used: input.allow_used ?? false,
        p_project_ids: input.project_ids ?? null,
      });
      if (error) throw new Error(formatRateConflictMessage(new Error(error.message)));
      const rate = await enrichTeamMemberRate(data as import("@/lib/types").TeamMemberRate);
      return { rate };
    }
    case "end": {
      const { data, error } = await supabase.rpc("end_team_member_rate", {
        p_rate_id: input.rate_id,
        p_effective_to: input.effective_to ?? new Date().toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);
      return { rate: data as import("@/lib/types").TeamMemberRate };
    }
    case "replace": {
      const { data, error } = await supabase.rpc("replace_team_member_rate", {
        p_rate_id: input.rate_id,
        p_new_effective_from: input.effective_from,
        p_name: input.name ?? null,
        p_rate_type: input.rate_type ?? null,
        p_amount: input.amount ?? null,
        p_currency: input.currency ?? null,
        p_description: input.description ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw new Error(error.message);
      return { rate: data as import("@/lib/types").TeamMemberRate };
    }
    case "set_default": {
      const { data, error } = await supabase.rpc("set_default_team_member_rate", {
        p_rate_id: input.rate_id,
      });
      if (error) throw new Error(error.message);
      return { rate: data as import("@/lib/types").TeamMemberRate };
    }
    case "delete": {
      const { error } = await supabase.rpc("delete_team_member_rate", {
        p_rate_id: input.rate_id,
      });
      if (error) throw new Error(error.message);
      return { deleted: true };
    }
    default:
      throw new Error(`Unsupported action: ${input.action}`);
  }
}

export function useManageTeamMemberRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ManageRateInput) => {
      try {
        return await manageRateViaRpc(input);
      } catch (rpcErr) {
        const msg = rpcErr instanceof Error ? rpcErr.message : "";
        // Fall back to edge function when RPC is unavailable (pre-migration environments)
        if (!msg.includes("create_team_member_rate") && !msg.includes("Could not find the function")) {
          throw rpcErr;
        }
        const { data, error } = await supabase.functions.invoke<{ rate?: import("@/lib/types").TeamMemberRate; deleted?: boolean }>(
          "team-member-rates",
          { body: input },
        );
        if (error) await throwEdgeFunctionError(error);
        return data!;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.teamMemberRates(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.contacts });
      qc.invalidateQueries({ queryKey: qk.contactActivities(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.projects });
      if (vars.rate_id) {
        qc.invalidateQueries({ queryKey: qk.rateUsage(vars.rate_id) });
      }
      qc.invalidateQueries({ queryKey: qk.teamFinancialSummary(vars.person_id) });
      qc.invalidateQueries({ queryKey: ["payouts"] });
      qc.invalidateQueries({ queryKey: ["contractor_invoices"] });
    },
  });
}

export function useChangeTeamMemberRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      person_id: string;
      rate_type: import("@/lib/types").RateType;
      amount: number;
      currency?: string;
      effective_from: string;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("change_team_member_rate", {
        p_person_id: input.person_id,
        p_rate_type: input.rate_type,
        p_amount: input.amount,
        p_currency: input.currency ?? "EUR",
        p_effective_from: input.effective_from,
        p_notes: input.notes ?? null,
      });
      if (!error && data) return data as import("@/lib/types").TeamMemberRate;

      // Fallback when RPC migration is not yet applied
      if (error?.message?.includes("change_team_member_rate")) {
        await supabase
          .from("team_member_rates")
          .update({ effective_to: input.effective_from })
          .eq("person_id", input.person_id)
          .is("effective_to", null);
        const { data: inserted, error: insertErr } = await supabase
          .from("team_member_rates")
          .insert({
            person_id: input.person_id,
            rate_type: input.rate_type,
            amount: input.amount,
            currency: input.currency ?? "EUR",
            effective_from: input.effective_from,
            notes: input.notes ?? null,
          })
          .select()
          .single();
        if (insertErr) throw new Error(insertErr.message);
        if (input.rate_type === "hourly") {
          await supabase.from("contacts").update({ hourly_rate: input.amount }).eq("id", input.person_id);
        }
        return inserted as import("@/lib/types").TeamMemberRate;
      }
      if (error) throw new Error(error.message);
      throw new Error("Could not change rate");
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.teamMemberRates(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.contacts });
      qc.invalidateQueries({ queryKey: qk.contactActivities(vars.person_id) });
    },
  });
}

export function useCreateTeamMemberRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      person_id: string;
      rate_type: import("@/lib/types").RateType;
      amount: number;
      currency?: string;
      effective_from: string;
      effective_to?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await supabase.from("team_member_rates").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.teamMemberRates(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(vars.person_id) });
    },
  });
}

// --------------------------------------------------------------------------
// Payouts
// --------------------------------------------------------------------------
export function usePayouts(personId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.payouts(personId),
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      let query = supabase.from("payouts").select("*").order("payment_date", { ascending: false });
      if (personId) query = query.eq("person_id", personId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").Payout[];
    },
  });
}

export function useCreatePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<import("@/lib/types").Payout, "id" | "created_at" | "updated_at" | "metadata"> & { metadata?: Record<string, unknown> }) => {
      const { data, error } = await supabase.from("payouts").insert(input).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.payouts(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.payouts() });
      qc.invalidateQueries({ queryKey: qk.financeOverview });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.teamKpis });
    },
  });
}

export const CONTRACTOR_INVOICES_BUCKET = "contractor-invoices";

const CONTRACTOR_INVOICE_SELECT = "*, projects(id, name)";

function invalidatePayableQueries(qc: ReturnType<typeof useQueryClient>, filters?: { personId?: string; clientInvoiceId?: string; projectId?: string }) {
  qc.invalidateQueries({ queryKey: ["team_member_payables"] });
  qc.invalidateQueries({ queryKey: ["team_payables_summary"] });
  if (filters?.personId) qc.invalidateQueries({ queryKey: qk.teamMemberSummary(filters.personId) });
  qc.invalidateQueries({ queryKey: qk.financeOverview });
  qc.invalidateQueries({ queryKey: qk.teamRoster });
  qc.invalidateQueries({ queryKey: qk.teamKpis });
  qc.invalidateQueries({ queryKey: qk.invoices });
  qc.invalidateQueries({ queryKey: qk.invoiceMetrics });
}

export function useTeamPayablesSummary(filters?: {
  person_id?: string;
  client_invoice_id?: string;
  project_id?: string;
  period?: "mtd" | "ytd" | "lifetime";
  include_reconciliation?: boolean;
}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.teamPayablesSummary({
      personId: filters?.person_id,
      clientInvoiceId: filters?.client_invoice_id,
      projectId: filters?.project_id,
      period: filters?.period,
    }),
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<import("@/lib/types").TeamPayablesSummary>(
        "get-team-payables-summary",
        { body: filters ?? {}, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No payables summary returned.");
      return data;
    },
  });
}

export function useCreateTeamMemberPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown> & { person_id: string; amount: number; currency?: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ payable: import("@/lib/types").TeamMemberPayableEnriched }>(
        "team-member-payables",
        { body: { action: "create", auto_approve: true, ...input }, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.payable) throw new Error("Payable was not created.");
      return data.payable;
    },
    onSuccess: (payable) => invalidatePayableQueries(qc, { personId: payable.person_id, clientInvoiceId: payable.client_invoice_id ?? undefined }),
  });
}

export function useBulkCreateTeamMemberPayables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      rows: Array<Record<string, unknown> & { person_id: string; amount: number; currency?: string }>;
      auto_approve?: boolean;
      client_invoice_id?: string;
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ payables: import("@/lib/types").TeamMemberPayableEnriched[] }>(
        "team-member-payables",
        { body: { action: "bulk_create", ...input }, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.payables) throw new Error("Payables were not created.");
      return data.payables;
    },
    onSuccess: (payables, vars) => {
      const personId = payables[0]?.person_id;
      invalidatePayableQueries(qc, { personId, clientInvoiceId: vars.client_invoice_id });
    },
  });
}

export function useUpdateTeamMemberPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { payable_id: string; patch: Record<string, unknown> }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ payable: import("@/lib/types").TeamMemberPayableEnriched }>(
        "team-member-payables",
        { body: { action: "update", ...input }, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.payable) throw new Error("Payable was not updated.");
      return data.payable;
    },
    onSuccess: (payable) => invalidatePayableQueries(qc, { personId: payable.person_id, clientInvoiceId: payable.client_invoice_id ?? undefined }),
  });
}

export function useChangeTeamMemberPayableState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { payable_id: string; action: "approve" | "release" | "cancel"; notes?: string | null }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ payable: import("@/lib/types").TeamMemberPayableEnriched }>(
        "change-team-member-payable-state",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.payable) throw new Error("Payable state was not changed.");
      return data.payable;
    },
    onSuccess: (payable) => invalidatePayableQueries(qc, { personId: payable.person_id, clientInvoiceId: payable.client_invoice_id ?? undefined }),
  });
}

export function useLinkPayableContractorInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { payable_id: string; contractor_invoice_id: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ payable: import("@/lib/types").TeamMemberPayableEnriched }>(
        "team-member-payables",
        { body: { action: "link_contractor_invoice", ...input }, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.payable) throw new Error("Supporting invoice was not linked.");
      return data.payable;
    },
    onSuccess: (payable) => invalidatePayableQueries(qc, { personId: payable.person_id }),
  });
}

function invalidateContractorInvoiceQueries(qc: ReturnType<typeof useQueryClient>, personId?: string) {
  qc.invalidateQueries({ queryKey: qk.contractorInvoices(personId) });
  qc.invalidateQueries({ queryKey: qk.contractorInvoices() });
  if (personId) {
    qc.invalidateQueries({ queryKey: qk.contractorInvoiceSummary(personId) });
    qc.invalidateQueries({ queryKey: qk.teamMemberSummary(personId) });
  }
  qc.invalidateQueries({ queryKey: qk.financeOverview });
  qc.invalidateQueries({ queryKey: qk.teamRoster });
  qc.invalidateQueries({ queryKey: qk.teamKpis });
  invalidatePayableQueries(qc, personId ? { personId } : undefined);
}

export function useContractorInvoices(personId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.contractorInvoices(personId),
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      let query = supabase
        .from("contractor_invoices")
        .select(CONTRACTOR_INVOICE_SELECT)
        .order("invoice_date", { ascending: false });
      if (personId) query = query.eq("person_id", personId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").ContractorInvoice[];
    },
  });
}

export function useContractorInvoiceSummary(personId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.contractorInvoiceSummary(personId),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contractor_invoices")
        .select("*")
        .eq("person_id", personId);
      if (error) throw new Error(error.message);
      const invoices = (data ?? []) as import("@/lib/types").ContractorInvoice[];
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const open = invoices.filter((i) => ["received", "approved", "partially_paid"].includes(i.status));
      return {
        outstanding: open.reduce((s, i) => s + Math.max(0, Number(i.total) - Number(i.paid_amount)), 0),
        due_this_month: open
          .filter((i) => i.due_date && new Date(i.due_date).getMonth() === month && new Date(i.due_date).getFullYear() === year)
          .reduce((s, i) => s + Math.max(0, Number(i.total) - Number(i.paid_amount)), 0),
        paid_ytd: invoices
          .filter((i) => i.status === "paid" && i.paid_at && new Date(i.paid_at).getFullYear() === year)
          .reduce((s, i) => s + Number(i.paid_amount), 0),
        invoice_count: invoices.length,
      } satisfies import("@/lib/types").ContractorInvoiceSummary;
    },
  });
}

export function useCreateContractorInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      person_id: string;
      invoice_number?: string | null;
      invoice_date: string;
      due_date?: string | null;
      period_start?: string | null;
      period_end?: string | null;
      project_id?: string | null;
      currency?: string;
      subtotal?: number;
      tax_amount?: number;
      total: number;
      description?: string | null;
      source?: string;
      status?: string;
      file_path?: string | null;
    }) => {
      const { data, error } = await supabase.functions.invoke<{ invoice: import("@/lib/types").ContractorInvoice }>(
        "contractor-invoices",
        { body: { action: "create", ...input } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.invoice) throw new Error("Invoice was not created.");
      return data.invoice;
    },
    onSuccess: (invoice) => invalidateContractorInvoiceQueries(qc, invoice.person_id),
  });
}

export function useUpdateContractorInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      person_id: string;
      patch: Partial<import("@/lib/types").ContractorInvoice>;
    }) => {
      const { data, error } = await supabase.functions.invoke<{ invoice: import("@/lib/types").ContractorInvoice }>(
        "contractor-invoices",
        { body: { action: "update", invoice_id: input.id, patch: input.patch } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.invoice) throw new Error("Invoice was not updated.");
      return data.invoice;
    },
    onSuccess: (invoice) => invalidateContractorInvoiceQueries(qc, invoice.person_id),
  });
}

export function useContractorInvoiceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      invoice_id: string;
      person_id: string;
      action: "approve" | "dispute" | "cancel";
    }) => {
      const { data, error } = await supabase.functions.invoke<{ invoice: import("@/lib/types").ContractorInvoice }>(
        "contractor-invoices",
        { body: input },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.invoice) throw new Error("Action failed.");
      return data.invoice;
    },
    onSuccess: (_d, vars) => invalidateContractorInvoiceQueries(qc, vars.person_id),
  });
}

export function useUploadContractorInvoiceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invoice_id: string; person_id: string; file: File }) => {
      const buffer = await input.file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const { data, error } = await supabase.functions.invoke<{ file_path: string; signed_url: string }>(
        "contractor-invoice-file",
        {
          body: {
            action: "upload",
            invoice_id: input.invoice_id,
            person_id: input.person_id,
            file_name: input.file.name,
            content_type: input.file.type,
            file_base64: base64,
          },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.file_path) throw new Error("Upload failed.");
      return data;
    },
    onSuccess: (_d, vars) => invalidateContractorInvoiceQueries(qc, vars.person_id),
  });
}

export async function getContractorInvoiceFileUrl(invoiceId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<{ signed_url: string }>(
    "contractor-invoice-file",
    { body: { action: "download", invoice_id: invoiceId } },
  );
  if (error) {
    await throwEdgeFunctionError(error);
    return null;
  }
  return data?.signed_url ?? null;
}

export function usePayoutsWithAllocations(personId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...qk.payouts(personId), "allocations"],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      let query = supabase
        .from("payouts")
        .select("*, contractor_invoice_payments(id, contractor_invoice_id, allocated_amount, contractor_invoices(id, invoice_number, total, currency))")
        .order("payment_date", { ascending: false });
      if (personId) query = query.eq("person_id", personId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").PayoutWithAllocations[];
    },
  });
}

export function useAllocateInvoicePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      person_id: string;
      amount: number;
      currency: string;
      payment_date: string;
      period_start?: string | null;
      period_end?: string | null;
      project_id?: string | null;
      provider: import("@/lib/types").PayoutProvider;
      status?: string;
      notes?: string | null;
      allocations?: { contractor_invoice_id: string; allocated_amount: number }[];
      payable_allocations?: { payable_id: string; allocated_amount: number }[];
    }) => {
      const { data, error } = await supabase.functions.invoke<{
        payout: import("@/lib/types").Payout;
      }>("allocate-invoice-payment", { body: input });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.payout) throw new Error("Payment was not recorded.");
      return data.payout;
    },
    onSuccess: (payout, vars) => {
      qc.invalidateQueries({ queryKey: qk.payouts(vars.person_id) });
      qc.invalidateQueries({ queryKey: qk.payouts() });
      qc.invalidateQueries({ queryKey: [...qk.payouts(vars.person_id), "allocations"] });
      invalidateContractorInvoiceQueries(qc, vars.person_id);
      invalidatePayableQueries(qc, { personId: vars.person_id });
    },
  });
}

export function useUpdateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const { data, error } = await supabase.functions.invoke<{ contact: import("@/lib/types").Contact }>(
        "team-member-update",
        { body: { person_id: input.id, patch: input.patch } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.contact) throw new Error("Member was not updated.");
      return data.contact;
    },
    onSuccess: (contact) => {
      qc.invalidateQueries({ queryKey: qk.contacts });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(contact.id) });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.teamKpis });
    },
  });
}

function invalidateTeamMemberQueries(qc: ReturnType<typeof useQueryClient>, personId: string) {
  qc.invalidateQueries({ queryKey: qk.contacts });
  qc.invalidateQueries({ queryKey: qk.teamMemberSummary(personId) });
  qc.invalidateQueries({ queryKey: qk.teamRoster });
  qc.invalidateQueries({ queryKey: qk.teamKpis });
  qc.invalidateQueries({ queryKey: qk.contactActivities(personId) });
  qc.invalidateQueries({ queryKey: qk.profiles });
}

export function useTeamMemberStatusChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { person_id: string; action: "deactivate" | "reactivate" }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ contact: Contact; action: string }>(
        "team-member-status",
        {
          body: input,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.contact) throw new Error("Member status was not updated.");
      return data.contact;
    },
    onSuccess: (contact) => invalidateTeamMemberQueries(qc, contact.id),
  });
}

export function useTeamMemberDeleteDependencies(personId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["team_member_delete_deps", personId],
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<import("@/lib/types").TeamMemberDeleteCheck>(
        "delete-team-member",
        {
          body: { person_id: personId, action: "check_dependencies" },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("Could not load deletion dependencies.");
      return data;
    },
  });
}

export function useDeleteTeamMemberPermanently() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      person_id: string;
      confirmation_text: string;
      delete_auth_user?: boolean;
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        deleted: boolean;
        auth_user_deleted?: boolean;
        auth_delete_error?: string;
        message?: string;
      }>("delete-team-member", {
        body: { ...input, action: "delete" },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (!data?.deleted) throw new Error("Member was not deleted.");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.contacts });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.teamKpis });
      qc.invalidateQueries({ queryKey: qk.profiles });
      qc.invalidateQueries({ queryKey: qk.companyPeople() });
    },
  });
}

// --------------------------------------------------------------------------
// Company financial metrics (computed client-side from invoices/projects)
// --------------------------------------------------------------------------
export function useCompanyMetrics(companyId: string) {
  const invoicesQuery = useInvoices({ enabled: !!companyId });
  const projectsQuery = useProjects();

  return useQuery({
    queryKey: qk.companyMetrics(companyId),
    enabled: !!companyId,
    queryFn: async () => {
      const invoices = (invoicesQuery.data ?? []).filter((i) => i.client_id === companyId);
      const projects = (projectsQuery.data ?? []).filter(
        (p) => p.organization_id === companyId || p.client_id === companyId,
      );

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();

      const paid = invoices.filter((i) => i.status === "paid");
      const open = invoices.filter((i) => isOutstandingReceivable(i));

      const lifetime = paid.reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);
      const ytd = paid
        .filter((i) => new Date(i.paid_date ?? i.issue_date).getFullYear() === year)
        .reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);
      const mtd = paid
        .filter((i) => {
          const d = new Date(i.paid_date ?? i.issue_date);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);
      const outstanding = open.reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);
      const overdue = sumOverdueReceivablesEur(invoices).total;

      const activeProjects = projects.filter((p) => !p.archived_at && !p.is_draft && (p.status === "in-progress" || p.status === "planning")).length;
      const budgets = projects.map((p) => Number(p.budget)).filter((b) => b > 0);
      const avgProjectValue = budgets.length ? budgets.reduce((a, b) => a + b, 0) / budgets.length : 0;

      return {
        lifetime_revenue: lifetime,
        revenue_ytd: ytd,
        revenue_mtd: mtd,
        outstanding,
        overdue,
        active_projects: activeProjects,
        avg_project_value: avgProjectValue,
      } satisfies import("@/lib/types").CompanyFinancialMetrics;
    },
  });
}

export function useTeamMemberSummary(personId: string, options?: { enabled?: boolean; includeFinancials?: boolean }) {
  const includeFinancials = options?.includeFinancials ?? true;
  return useQuery({
    queryKey: [...qk.teamMemberSummary(personId), includeFinancials],
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: async () => {
      const [ratesRes, payoutsRes, projectsRes, invoicesRes, contactRes] = await Promise.all([
        includeFinancials
          ? supabase.from("team_member_rates").select(TEAM_MEMBER_RATE_SELECT).eq("person_id", personId).order("effective_from", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        includeFinancials
          ? supabase.from("payouts").select("*").eq("person_id", personId).order("payment_date", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase.from("projects").select(PROJECT_SELECT),
        includeFinancials
          ? supabase.from("contractor_invoices").select("*").eq("person_id", personId)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("contacts").select("metadata, availability").eq("id", personId).maybeSingle(),
      ]);
      if (ratesRes.error) throw new Error(ratesRes.error.message);
      if (payoutsRes.error) throw new Error(payoutsRes.error.message);
      if (projectsRes.error) throw new Error(projectsRes.error.message);
      if (invoicesRes.error) throw new Error(invoicesRes.error.message);
      if (contactRes.error) throw new Error(contactRes.error.message);

      const { mapTeamMemberRateRow } = await import("@/lib/teamMemberRates");
      const rates = (ratesRes.data ?? []).map((row) =>
        mapTeamMemberRateRow(row as Record<string, unknown>),
      );
      const payouts = (payoutsRes.data ?? []) as import("@/lib/types").Payout[];
      const contractorInvoices = (invoicesRes.data ?? []) as import("@/lib/types").ContractorInvoice[];
      const projects = (projectsRes.data ?? []).map(mapProject);
      const today = new Date().toISOString().slice(0, 10);
      const defaultRate = getDefaultRate(rates, today);
      const currentRate = defaultRate ?? rates.find((r) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today)) ?? rates[0] ?? null;
      const activeRateCount = rates.filter((r) => r.status === "active").length;

      let paidMtdEur: import("@/lib/types").EurReportingAggregate | null = null;
      let paidYtdEur: import("@/lib/types").EurReportingAggregate | null = null;
      let outstandingPayablesEur: import("@/lib/types").EurReportingAggregate | null = null;
      let readyToPayEur: import("@/lib/types").EurReportingAggregate | null = null;

      if (includeFinancials) {
        try {
          const token = await getAuthToken();
          const [mtdFx, ytdFx, payablesFx] = await Promise.all([
            supabase.functions.invoke("team-financial-summary", {
              body: { person_id: personId, period: "mtd" },
              headers: { Authorization: `Bearer ${token}` },
            }),
            supabase.functions.invoke("team-financial-summary", {
              body: { person_id: personId, period: "ytd" },
              headers: { Authorization: `Bearer ${token}` },
            }),
            supabase.functions.invoke<import("@/lib/types").TeamPayablesSummary>("get-team-payables-summary", {
              body: { person_id: personId, period: "lifetime" },
              headers: { Authorization: `Bearer ${token}` },
            }),
          ]);
          if (!mtdFx.error && mtdFx.data) {
            paidMtdEur = (mtdFx.data as { paid: import("@/lib/types").EurReportingAggregate }).paid;
          }
          if (!ytdFx.error && ytdFx.data) {
            paidYtdEur = (ytdFx.data as { paid: import("@/lib/types").EurReportingAggregate }).paid;
          }
          if (!payablesFx.error && payablesFx.data?.summary) {
            outstandingPayablesEur = payablesFx.data.summary.outstanding_eur;
            readyToPayEur = payablesFx.data.summary.ready_to_pay_eur;
          }
        } catch {
          // FX edge function may not be deployed yet — fall back to native sums only
        }
      }

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const paid = payouts.filter((p) => p.status === "paid");
      const paidMtd = paid
        .filter((p) => p.payment_date && new Date(p.payment_date).getMonth() === month && new Date(p.payment_date).getFullYear() === year)
        .reduce((s, p) => s + Number(p.amount), 0);
      const paidYtd = paid
        .filter((p) => p.payment_date && new Date(p.payment_date).getFullYear() === year)
        .reduce((s, p) => s + Number(p.amount), 0);
      const lifetimePaid = paid.reduce((s, p) => s + Number(p.amount), 0);
      const pending = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount), 0);
      const lastPayment = paid.sort((a, b) => (b.payment_date ?? "").localeCompare(a.payment_date ?? ""))[0]?.payment_date ?? null;

      const activeProjectList = projects.filter(
        (p) =>
          !p.archived_at &&
          !p.is_draft &&
          (p.status === "in-progress" || p.status === "planning") &&
          (p.team_contacts ?? []).some((c) => c.id === personId),
      );

      const openPayablesSummary = includeFinancials
        ? await (async () => {
            try {
              const token = await getAuthToken();
              const { data } = await supabase.functions.invoke<import("@/lib/types").TeamPayablesSummary>(
                "get-team-payables-summary",
                { body: { person_id: personId, period: "lifetime" }, headers: { Authorization: `Bearer ${token}` } },
              );
              return data?.summary;
            } catch {
              return null;
            }
          })()
        : null;

      const outstandingPayables = openPayablesSummary?.outstanding_eur?.total_eur ?? 0;
      const readyToPay = openPayablesSummary?.ready_to_pay_eur?.total_eur ?? 0;

      const contact = contactRes.data;
      const meta =
        contact?.metadata && typeof contact.metadata === "object" && !Array.isArray(contact.metadata)
          ? (contact.metadata as Record<string, unknown>)
          : null;
      const capacity = meta?.capacity_percent != null
        ? `${meta.capacity_percent}%`
        : meta?.weekly_available_hours != null
          ? `${meta.weekly_available_hours}h/wk`
          : contact?.availability === "full"
            ? "100%"
            : null;

      return {
        paid_mtd: paidMtd,
        paid_ytd: paidYtd,
        lifetime_paid: lifetimePaid,
        pending,
        last_payment_date: lastPayment,
        current_rate: currentRate,
        default_rate: defaultRate,
        active_rate_count: activeRateCount,
        paid_mtd_eur: paidMtdEur,
        paid_ytd_eur: paidYtdEur,
        outstanding_payables_eur: outstandingPayablesEur,
        ready_to_pay_eur: readyToPayEur,
        outstanding_invoices_eur: outstandingPayablesEur,
        active_projects: activeProjectList.length,
        active_project_names: activeProjectList.map((p) => p.name),
        outstanding_payables: outstandingPayables,
        ready_to_pay: readyToPay,
        outstanding_invoices: outstandingPayables,
        available_capacity: capacity,
      } satisfies import("@/lib/types").TeamMemberFinancialSummary;
    },
  });
}

export function usePersonProjectAssignments(personId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.personProjectAssignments(personId),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_contact_assignees")
        .select("*, projects(id, name, status), team_member_rates(*)")
        .eq("contact_id", personId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").ProjectContactAssignment[];
    },
  });
}

export function useUpsertProjectAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      contact_id: string;
      role_on_project?: string | null;
      allocation_percent?: number | null;
      weekly_hours?: number | null;
      start_date?: string | null;
      end_date?: string | null;
      is_active?: boolean;
      notes?: string | null;
      rate_id?: string | null;
      rate_snapshot_amount?: number | null;
      rate_snapshot_currency?: string | null;
    }) => {
      const extended = {
        project_id: input.project_id,
        contact_id: input.contact_id,
        role_on_project: input.role_on_project ?? null,
        allocation_percent: input.allocation_percent ?? null,
        weekly_hours: input.weekly_hours ?? null,
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        is_active: input.is_active ?? true,
        notes: input.notes ?? null,
        rate_id: input.rate_id ?? null,
        rate_snapshot_amount: input.rate_snapshot_amount ?? null,
        rate_snapshot_currency: input.rate_snapshot_currency ?? null,
        rate_snapshot_at: input.rate_id ? new Date().toISOString() : null,
      };
      let { data, error } = await supabase
        .from("project_contact_assignees")
        .upsert(extended, { onConflict: "project_id,contact_id" })
        .select()
        .single();
      if (error?.message?.includes("column")) {
        ({ data, error } = await supabase
          .from("project_contact_assignees")
          .upsert(
            { project_id: input.project_id, contact_id: input.contact_id },
            { onConflict: "project_id,contact_id" },
          )
          .select()
          .single());
      }
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.personProjectAssignments(vars.contact_id) });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(vars.contact_id) });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.teamKpis });
    },
  });
}

export function useEndProjectAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ project_id, contact_id }: { project_id: string; contact_id: string }) => {
      const { error: updateErr } = await supabase
        .from("project_contact_assignees")
        .update({
          is_active: false,
          end_date: new Date().toISOString().slice(0, 10),
        })
        .eq("project_id", project_id)
        .eq("contact_id", contact_id);
      if (updateErr?.message?.includes("column")) {
        const { error: deleteErr } = await supabase
          .from("project_contact_assignees")
          .delete()
          .eq("project_id", project_id)
          .eq("contact_id", contact_id);
        if (deleteErr) throw new Error(deleteErr.message);
        return;
      }
      if (updateErr) throw new Error(updateErr.message);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.personProjectAssignments(vars.contact_id) });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.teamMemberSummary(vars.contact_id) });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.teamKpis });
    },
  });
}

export function useCreateTeamActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contact_id: string;
      title: string;
      description?: string | null;
      kind?: import("@/lib/types").ActivityKind;
      entity_type?: string | null;
      entity_id?: string | null;
      visibility?: import("@/lib/types").ActivityVisibility;
    }) => {
      const { data: session } = await supabase.auth.getSession();
      const payload = {
        contact_id: input.contact_id,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind ?? "info",
        entity_type: input.entity_type ?? "team_member",
        entity_id: input.entity_id ?? input.contact_id,
        created_by: session.session?.user?.id ?? null,
      };
      let { data, error } = await supabase
        .from("activities")
        .insert({ ...payload, visibility: input.visibility ?? "team" })
        .select()
        .single();
      if (error?.message?.includes("visibility")) {
        ({ data, error } = await supabase.from("activities").insert(payload).select().single());
      }
      if (error) throw new Error(error.message);
      return data as import("@/lib/types").Activity;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.contactActivities(vars.contact_id) });
      qc.invalidateQueries({ queryKey: qk.activities });
    },
  });
}

export function useContactActivities(contactId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.contactActivities(contactId),
    enabled: (options?.enabled ?? true) && !!contactId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").Activity[];
    },
  });
}

export function useAddTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contact: Partial<Contact> & { name: string; email?: string | null };
      oxus_company_id: string;
      initial_rate?: import("@/lib/types").TeamMemberRateInput;
      project_id?: string | null;
    }) => {
      let personId: string;
      const email = input.contact.email?.trim().toLowerCase() ?? null;
      // Keep contacts.type = 'contractor' for schema compatibility; relationship is unified as team_member.
      // Do not write employment_type — legacy values remain untouched when updating existing people.
      const { employment_type: _ignoredEmployment, ...contactFields } = input.contact as Partial<Contact> & {
        employment_type?: string | null;
      };

      if (email) {
        const { data: existing } = await supabase.from("contacts").select("id").ilike("email", email).maybeSingle();
        if (existing?.id) {
          personId = existing.id;
          const { error: updErr } = await supabase
            .from("contacts")
            .update({
              ...contactFields,
              type: contactFields.type ?? "contractor",
              person_status: "active",
            })
            .eq("id", personId);
          if (updErr) throw new Error(updErr.message);
        } else {
          const { data, error } = await supabase
            .from("contacts")
            .insert({
              last_contact_at: new Date().toISOString(),
              type: "contractor",
              person_status: "active",
              stack: [],
              ...contactFields,
            })
            .select()
            .single();
          if (error) throw new Error(error.message);
          personId = (data as Contact).id;
        }
      } else {
        const { data, error } = await supabase
          .from("contacts")
          .insert({
            last_contact_at: new Date().toISOString(),
            type: "contractor",
            person_status: "active",
            stack: [],
            ...contactFields,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        personId = (data as Contact).id;
      }

      const { error: relErr } = await supabase.from("company_people").upsert(
        {
          company_id: input.oxus_company_id,
          person_id: personId,
          relationship_type: "team_member",
        },
        { onConflict: "company_id,person_id,relationship_type" },
      );
      if (relErr) throw new Error(relErr.message);

      if (input.initial_rate && input.initial_rate.amount > 0) {
        const rate = input.initial_rate;
        const { data: createdRate, error: createErr } = await supabase.functions.invoke<{ rate: import("@/lib/types").TeamMemberRate }>(
          "team-member-rates",
          {
            body: {
              action: "create",
              person_id: personId,
              name: rate.name,
              description: rate.description,
              rate_type: rate.rate_type,
              amount: rate.amount,
              currency: rate.currency ?? "EUR",
              project_ids: rate.project_ids?.length ? rate.project_ids : null,
              work_type: rate.work_type ?? null,
              is_default: rate.is_default ?? false,
              effective_from: rate.effective_from ?? new Date().toISOString().slice(0, 10),
              effective_to: rate.effective_to ?? null,
              notes: rate.notes ?? "Initial rate",
            },
          },
        );
        if (createErr) {
          const { error: rateErr } = await supabase.rpc("change_team_member_rate", {
            p_person_id: personId,
            p_rate_type: rate.rate_type,
            p_amount: rate.amount,
            p_currency: rate.currency ?? "EUR",
            p_effective_from: rate.effective_from ?? new Date().toISOString().slice(0, 10),
            p_notes: rate.notes ?? "Initial rate",
          });
          if (rateErr?.message?.includes("change_team_member_rate")) {
            const { error: insertErr } = await supabase.from("team_member_rates").insert({
              person_id: personId,
              name: rate.name ?? "Initial rate",
              rate_type: rate.rate_type,
              amount: rate.amount,
              currency: rate.currency ?? "EUR",
              project_ids: rate.project_ids?.length ? rate.project_ids : null,
              work_type: rate.work_type ?? null,
              is_default: rate.is_default ?? true,
              effective_from: rate.effective_from ?? new Date().toISOString().slice(0, 10),
              notes: rate.notes ?? "Initial rate",
            });
            if (insertErr) throw new Error(insertErr.message);
          } else if (rateErr) {
            throw new Error(rateErr.message);
          }
        } else if (!createdRate?.rate) {
          throw new Error("Could not create initial rate");
        }
      }

      if (input.project_id) {
        const { error: assignErr } = await supabase.from("project_contact_assignees").upsert(
          { project_id: input.project_id, contact_id: personId, is_active: true },
          { onConflict: "project_id,contact_id" },
        );
        if (assignErr) throw new Error(assignErr.message);
      }

      return personId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.contacts });
      qc.invalidateQueries({ queryKey: qk.companyPeople() });
      qc.invalidateQueries({ queryKey: qk.teamRoster });
      qc.invalidateQueries({ queryKey: qk.teamKpis });
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useTeamRoster(options?: { enabled?: boolean; includeFinancials?: boolean }) {
  const includeFinancials = options?.includeFinancials ?? true;
  const contactsQuery = useContacts({ enabled: options?.enabled ?? true });
  const companyPeopleQuery = useCompanyPeople();
  const projectsQuery = useProjects({ enabled: options?.enabled ?? true });

  return useQuery({
    queryKey: [...qk.teamRoster, includeFinancials],
    enabled: (options?.enabled ?? true) && contactsQuery.isSuccess && companyPeopleQuery.isSuccess && projectsQuery.isSuccess,
    queryFn: async () => {
      const contacts = contactsQuery.data ?? [];
      const companyPeople = companyPeopleQuery.data ?? [];
      const projects = projectsQuery.data ?? [];
      const teamIds = new Set<string>();
      for (const rel of companyPeople) {
        if (
          rel.relationship_type === "team_member" ||
          rel.relationship_type === "employee" ||
          rel.relationship_type === "contractor"
        ) {
          teamIds.add(rel.person_id);
        }
      }
      for (const c of contacts) {
        if (c.type === "contractor" || c.type === "agent") teamIds.add(c.id);
      }
      const teamContacts = contacts.filter((c) => teamIds.has(c.id));
      const personIds = teamContacts.map((c) => c.id);

      let ratesByPerson = new Map<string, import("@/lib/types").TeamMemberRate[]>();
      let payouts: import("@/lib/types").Payout[] = [];
      if (includeFinancials && personIds.length > 0) {
        const [ratesRes, payoutsRes] = await Promise.all([
          supabase.from("team_member_rates").select(TEAM_MEMBER_RATE_SELECT).in("person_id", personIds),
          supabase.from("payouts").select("*").in("person_id", personIds),
        ]);
        if (ratesRes.error) throw new Error(ratesRes.error.message);
        if (payoutsRes.error) throw new Error(payoutsRes.error.message);
        const { mapTeamMemberRateRow } = await import("@/lib/teamMemberRates");
        for (const row of ratesRes.data ?? []) {
          const r = mapTeamMemberRateRow(row as Record<string, unknown>);
          const list = ratesByPerson.get(r.person_id) ?? [];
          list.push(r);
          ratesByPerson.set(r.person_id, list);
        }
        payouts = (payoutsRes.data ?? []) as import("@/lib/types").Payout[];
      }

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();

      const rows: import("@/lib/types").TeamRosterRow[] = teamContacts.map((person) => {
        const rates = (ratesByPerson.get(person.id) ?? []).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
        const currentRate =
          rates.find((r) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today)) ??
          rates[0] ??
          null;
        const activeProjects = projects
          .filter(
            (p) =>
              !p.archived_at &&
              !p.is_draft &&
              (p.status === "in-progress" || p.status === "planning") &&
              (p.team_contacts ?? []).some((c) => c.id === person.id),
          )
          .map((p) => ({ id: p.id, name: p.name }));
        const personPayouts = payouts.filter((p) => p.person_id === person.id && p.status === "paid");
        const paidMtd = personPayouts
          .filter((p) => p.payment_date && new Date(p.payment_date).getFullYear() === year && new Date(p.payment_date).getMonth() === month)
          .reduce((s, p) => s + Number(p.amount), 0);
        const paidYtd = personPayouts
          .filter((p) => p.payment_date && new Date(p.payment_date).getFullYear() === year)
          .reduce((s, p) => s + Number(p.amount), 0);
        const lastPayment =
          personPayouts.sort((a, b) => (b.payment_date ?? "").localeCompare(a.payment_date ?? ""))[0]?.payment_date ?? null;
        return {
          person,
          current_rate: currentRate,
          active_projects: activeProjects,
          paid_mtd: paidMtd,
          paid_ytd: paidYtd,
          last_payment_date: lastPayment,
        };
      });

      return rows;
    },
  });
}

export function useTeamKpis(options?: { enabled?: boolean; includeFinancials?: boolean }) {
  const rosterQuery = useTeamRoster(options);
  const projectsQuery = useProjects({ enabled: options?.enabled ?? true });

  return useQuery({
    queryKey: [...qk.teamKpis, options?.includeFinancials ?? true],
    enabled: (options?.enabled ?? true) && rosterQuery.isSuccess,
    queryFn: async () => {
      const rows = rosterQuery.data ?? [];
      const projects = projectsQuery.data ?? [];
      const active = rows.filter((r) => r.person.person_status !== "inactive");
      const withCapacity = active.filter((r) => r.person.availability === "full" || r.person.availability === "partial");
      const fullyAllocated = active.filter((r) => r.person.availability === "busy");
      const paidThisMonth = options?.includeFinancials
        ? active.reduce((s, r) => s + r.paid_mtd, 0)
        : null;
      const activePersonIds = new Set(active.map((r) => r.person.id));
      const activeAssignments = projects.reduce(
        (s, p) => {
          if (p.status !== "in-progress" && p.status !== "planning") return s;
          if (p.archived_at || p.is_draft) return s;
          return s + (p.team_contacts ?? []).filter((c) => activePersonIds.has(c.id)).length;
        },
        0,
      );

      let outstandingPayables: number | null = null;
      let readyToPay: number | null = null;
      let hasPayableData = false;
      if (options?.includeFinancials) {
        try {
          const token = await getAuthToken();
          const { data, error } = await supabase.functions.invoke<import("@/lib/types").TeamPayablesSummary>(
            "get-team-payables-summary",
            { body: { period: "lifetime" }, headers: { Authorization: `Bearer ${token}` } },
          );
          if (!error && data?.summary) {
            hasPayableData = true;
            outstandingPayables = data.summary.outstanding_eur?.total_eur ?? null;
            readyToPay = data.summary.ready_to_pay_eur?.total_eur ?? null;
          }
        } catch {
          // Edge function may not be deployed yet
        }
      }

      return {
        active_team: active.length,
        available_capacity: withCapacity.length > 0 ? withCapacity.length : null,
        fully_allocated: fullyAllocated.length > 0 ? fullyAllocated.length : (active.some((r) => !!r.person.availability) ? 0 : null),
        paid_this_month: paidThisMonth,
        outstanding_payables: outstandingPayables,
        ready_to_pay: readyToPay,
        outstanding_invoices: outstandingPayables,
        active_assignments: activeAssignments,
        has_payout_data: options?.includeFinancials ?? false,
        has_capacity_data: active.some((r) => !!r.person.availability),
        has_payable_data: hasPayableData,
        has_invoice_data: hasPayableData,
      } satisfies import("@/lib/types").TeamKpiSummary;
    },
  });
}

// --------------------------------------------------------------------------
// Stripe integration
// --------------------------------------------------------------------------
export function useStripeConnectionStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.stripeConnection,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<import("@/lib/types").StripeConnectionStatus>(
        "stripe-connection-status",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      return data ?? { configured: false, connected: false, account: null, last_successful_sync_at: null, last_sync_error: null, webhook_last_received_at: null };
    },
  });
}

export function useStripeSyncInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input?: { force?: boolean; created_after?: string }) => {
      const token = await getAuthToken();
      const headers = { Authorization: `Bearer ${token}` };

      const { data, error } = await supabase.functions.invoke<import("@/lib/types").StripeSyncResult>(
        "stripe-sync-invoices",
        { body: input ?? {}, headers },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No sync result returned.");

      const aggregated: import("@/lib/types").StripeSyncResult = { ...data };
      let remaining = data.fx_remaining ?? 0;
      const MAX_FX_PASSES = 40;

      for (let pass = 0; pass < MAX_FX_PASSES && remaining > 0; pass++) {
        const { data: fxData, error: fxError } = await supabase.functions.invoke<import("@/lib/types").StripeSyncResult>(
          "backfill-invoice-fx",
          { body: { all: true, limit: 50 }, headers },
        );
        if (fxError) await throwEdgeFunctionError(fxError);
        if (!fxData) break;

        aggregated.fx_needed = (aggregated.fx_needed ?? 0) + (fxData.fx_needed ?? 0);
        aggregated.fx_converted = (aggregated.fx_converted ?? 0) + (fxData.fx_converted ?? 0);
        aggregated.fx_cached = (aggregated.fx_cached ?? 0) + (fxData.fx_cached ?? 0);
        aggregated.fx_unavailable = (aggregated.fx_unavailable ?? 0) + (fxData.fx_unavailable ?? 0);
        aggregated.fx_batches = (aggregated.fx_batches ?? 0) + (fxData.fx_batches ?? 0);
        aggregated.fx_remaining = fxData.fx_remaining ?? 0;
        aggregated.metrics_currency = "EUR";

        const prevRemaining = remaining;
        remaining = aggregated.fx_remaining;
        if (remaining >= prevRemaining && (fxData.fx_converted ?? 0) === 0) break;
      }

      return aggregated;
    },
    onSuccess: () => {
      invalidateInvoiceQueries(qc);
    },
  });
}

export function useReconcileStripePayments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input?: { month?: string; invoice_id?: string; force?: boolean; limit?: number }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<import("@/lib/types").StripeReconcilePaymentsResult>(
        "stripe-reconcile-invoice-payments",
        { body: input ?? {}, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No reconciliation result returned.");
      return data;
    },
    onSuccess: (_data, vars) => {
      invalidateInvoiceQueries(qc);
      qc.invalidateQueries({ queryKey: qk.paidRevenueReconciliation(vars?.month ?? getReportingMonthKey()) });
    },
  });
}

export function usePandaDocConnectionStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.pandadocConnection,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<import("@/lib/types").PandaDocConnectionStatus>(
        "pandadoc-connection-status",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      return data ?? {
        configured: false,
        connected: false,
        workspace_name: null,
        last_successful_sync_at: null,
        last_sync_error: null,
        webhook_last_received_at: null,
      };
    },
  });
}

export function usePandaDocListDocuments() {
  return useMutation({
    mutationFn: async (input?: { query?: string; status?: string; page?: number; count?: number }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        documents: import("@/lib/types").NormalizedPandaDocDocument[];
        page: number;
        count: number;
      }>("pandadoc-list-documents", {
        body: input ?? {},
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data ?? { documents: [], page: 1, count: 20 };
    },
  });
}

export function usePandaDocLinkProjectDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      pandadoc_document_id: string;
      document_type: import("@/lib/types").ProjectDocumentSlotType;
      label?: string;
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ document: Attachment }>(
        "pandadoc-link-project-document",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data?.document) throw new Error("No document returned.");
      return data.document;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.attachments("project", vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export function usePandaDocUnlinkProjectDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { attachment_id: string; project_id: string }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{ unlinked: boolean }>(
        "pandadoc-unlink-project-document",
        { body: input, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.attachments("project", vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
    },
  });
}

export function usePandaDocSyncProjectDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; force?: boolean }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        synced: number;
        failed: number;
        skipped?: boolean;
        reason?: string;
        errors?: string[];
      }>("pandadoc-sync-project-documents", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data ?? { synced: 0, failed: 0 };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.attachments("project", vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.projectTimelineEvents(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.pandadocConnection });
    },
  });
}

export function usePaidRevenueReconciliation(monthKey?: string) {
  const month = monthKey ?? getReportingMonthKey();
  return useQuery({
    queryKey: qk.paidRevenueReconciliation(month),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_payment_reconciliations")
        .select("*, invoices(number, client_name, external_id, external_url, hosted_invoice_url)")
        .eq("reporting_month", month)
        .order("paid_at", { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as import("@/lib/types").InvoicePaymentReconciliation[];
      return {
        rows,
        summary: summarizePaidRevenueRows(rows, month),
      };
    },
  });
}

export function usePaidRevenueExclusions(monthKey: string) {
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => loadPaidRevenueExclusions(monthKey));

  useEffect(() => {
    setExcludedIds(loadPaidRevenueExclusions(monthKey));
  }, [monthKey]);

  const toggleExclusion = useCallback((id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePaidRevenueExclusions(monthKey, next);
      return next;
    });
  }, [monthKey]);

  const includeAll = useCallback(() => {
    setExcludedIds(() => {
      const next = new Set<string>();
      savePaidRevenueExclusions(monthKey, next);
      return next;
    });
  }, [monthKey]);

  return { excludedIds, toggleExclusion, includeAll };
}

export function useStripeCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      company_id: string;
      project_id?: string;
      currency: string;
      due_date?: string;
      memo?: string;
      line_items: Array<{ description: string; quantity: number; unit_amount: number }>;
      action: "save_draft" | "finalize" | "finalize_and_send";
    }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke("stripe-create-invoice", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data as { ok: boolean; invoice: Invoice | null; hosted_invoice_url: string | null };
    },
    onSuccess: () => invalidateInvoiceQueries(qc),
  });
}

export function useInvoiceMetrics() {
  const invoicesQuery = useInvoices();
  return useQuery({
    queryKey: qk.invoiceMetrics,
    queryFn: async () => {
      const invoices = invoicesQuery.data ?? [];
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const open = invoices.filter((i) => isOutstandingReceivable(i));
      const outstanding = open.reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);
      const overdue = sumOverdueReceivablesEur(invoices).total;
      const paidThisMonth = invoices
        .filter((i) => i.status === "paid")
        .filter((i) => {
          const d = new Date(i.paid_date ?? i.paid_at ?? i.issue_date);
          return d.getMonth() === month && d.getFullYear() === year;
        })
        .reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);
      const drafts = invoices.filter((i) => i.status === "draft").length;
      const invoicedYtd = invoices
        .filter((i) => new Date(i.issue_date).getFullYear() === year)
        .reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);
      return { outstanding, overdue, paidThisMonth, drafts, invoicedYtd };
    },
    enabled: invoicesQuery.isSuccess,
  });
}

export function useFinanceOverview() {
  const invoicesQuery = useInvoices();
  const payoutsQuery = usePayouts();
  const projectsQuery = useProjects();

  return useQuery({
    queryKey: qk.financeOverview,
    queryFn: async () => {
      const invoices = invoicesQuery.data ?? [];
      const payouts = payoutsQuery.data ?? [];
      const projects = projectsQuery.data ?? [];
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();

      let payablesSummary: import("@/lib/types").TeamPayablesSummary | null = null;
      try {
        const token = await getAuthToken();
        const { data, error } = await supabase.functions.invoke<import("@/lib/types").TeamPayablesSummary>(
          "get-team-payables-summary",
          { body: { period: "lifetime" }, headers: { Authorization: `Bearer ${token}` } },
        );
        if (!error && data) payablesSummary = data;
      } catch {
        // Payables edge function may not be deployed yet
      }

      const revenueMtd = invoices
        .filter((i) => i.status === "paid")
        .filter((i) => {
          const d = new Date(i.paid_date ?? i.issue_date);
          return d.getMonth() === month && d.getFullYear() === year;
        })
        .reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);

      const revenueYtd = invoices
        .filter((i) => i.status === "paid" && new Date(i.paid_date ?? i.issue_date).getFullYear() === year)
        .reduce((s, i) => s + (invoiceTotalEur(i) ?? 0), 0);

      const receivables = invoices
        .filter((i) => isOutstandingReceivable(i))
        .reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);

      const overdueReceivables = sumOverdueReceivablesEur(invoices).total;

      const payoutsMtd = payouts
        .filter((p) => p.status === "paid" && p.payment_date)
        .filter((p) => {
          const d = new Date(p.payment_date!);
          return d.getMonth() === month && d.getFullYear() === year;
        })
        .reduce((s, p) => s + Number(p.amount), 0);

      const payoutsYtd = payouts
        .filter((p) => p.status === "paid" && p.payment_date && new Date(p.payment_date).getFullYear() === year)
        .reduce((s, p) => s + Number(p.amount), 0);

      const revenueByClient = new Map<string, number>();
      for (const inv of invoices.filter((i) => i.status === "paid")) {
        const key = inv.client_name ?? "Unknown";
        revenueByClient.set(key, (revenueByClient.get(key) ?? 0) + (invoiceTotalEur(inv) ?? 0));
      }

      const hasCostData = payouts.length > 0 || (payablesSummary?.payables.length ?? 0) > 0;
      const teamCostsAccrued = payablesSummary?.summary.outstanding_eur?.total_eur ?? null;
      const readyToPay = payablesSummary?.summary.ready_to_pay_eur?.total_eur ?? null;
      const teamPaymentsMtd = payablesSummary?.summary.paid_period_eur?.total_eur ?? payoutsMtd;
      const grossMargin = hasCostData && teamCostsAccrued != null
        ? revenueYtd - (payablesSummary?.summary.outstanding_eur?.total_eur ?? 0) - payoutsYtd
        : hasCostData ? revenueYtd - payoutsYtd : null;

      return {
        revenue_mtd: revenueMtd,
        revenue_ytd: revenueYtd,
        receivables,
        overdue_receivables: overdueReceivables,
        payouts_mtd: payoutsMtd,
        payouts_ytd: payoutsYtd,
        team_costs_accrued: teamCostsAccrued,
        ready_to_pay: readyToPay,
        team_payments_mtd: teamPaymentsMtd,
        gross_margin: grossMargin,
        has_cost_data: hasCostData,
        has_payable_data: (payablesSummary?.payables.length ?? 0) > 0,
        has_unconverted: payablesSummary?.summary.outstanding_eur?.has_unconverted ?? false,
        revenue_by_client: Array.from(revenueByClient.entries()).map(([name, amount]) => ({ name, amount })),
        active_projects: projects.filter((p) => !p.archived_at && !p.is_draft && p.status === "in-progress").length,
      };
    },
    enabled: invoicesQuery.isSuccess && payoutsQuery.isSuccess && projectsQuery.isSuccess,
  });
}

export function useExpenses() {
  return useQuery({
    queryKey: qk.expenses,
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("expense_date", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").Expense[];
    },
  });
}

/** Companies alias */
export const useCompanies = useClients;
export const usePeople = useContacts;

// --------------------------------------------------------------------------
// CRM Person record
// --------------------------------------------------------------------------
export type CrmPersonDetailResponse = {
  person: Contact;
  primary_company: Client | null;
  companies: Array<import("@/lib/types").CompanyPerson & { company: Client | null }>;
  owner: Profile | null;
  projects: ProjectWithAssignees[];
  opportunities: Quote[];
  summary: {
    last_interaction_at: string | null;
    next_meeting_at: string | null;
    meeting_count: number;
    active_projects: number;
    open_opportunities: number;
    interaction_count: number;
    email_thread_count: number;
  };
  name_suggestion: { suggested_name: string; confidence: number; source: string } | null;
  needs_review: boolean;
  recent_activities: import("@/lib/types").Activity[];
  recent_google_interactions: import("@/lib/types").GoogleInteraction[];
  association_counts: { companies: number; projects: number; opportunities: number };
};

export type CrmPersonActivityItem = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  occurred_at: string;
  source: string;
  company_id: string | null;
  metadata: Record<string, unknown>;
  participants: unknown;
};

async function invokeCrmPersonRecord<T>(body: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken();
  const { data, error } = await supabase.functions.invoke<T>("crm-person-record", {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) await throwEdgeFunctionError(error);
  return data as T;
}

function invalidateCrmPersonQueries(qc: ReturnType<typeof useQueryClient>, personId: string) {
  qc.invalidateQueries({ queryKey: qk.crmPersonDetail(personId) });
  qc.invalidateQueries({ queryKey: ["crm_person_activities", personId] });
  qc.invalidateQueries({ queryKey: qk.crmPersonSources(personId) });
  qc.invalidateQueries({ queryKey: qk.contacts });
  qc.invalidateQueries({ queryKey: qk.contactActivities(personId) });
}

export function useCrmPersonDetail(personId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.crmPersonDetail(personId),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: () => invokeCrmPersonRecord<CrmPersonDetailResponse>({
      action: "get_detail",
      person_id: personId,
    }),
  });
}

export function useCrmPersonActivities(
  personId: string,
  options?: { enabled?: boolean; filter?: string; offset?: number; limit?: number },
) {
  const filter = options?.filter ?? "all";
  const offset = options?.offset ?? 0;
  return useQuery({
    queryKey: qk.crmPersonActivities(personId, filter, offset),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: () => invokeCrmPersonRecord<{
      items: CrmPersonActivityItem[];
      total: number;
      has_more: boolean;
    }>({
      action: "get_activities",
      person_id: personId,
      filter,
      offset,
      limit: options?.limit ?? 20,
    }),
  });
}

export function useCrmPersonSources(personId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.crmPersonSources(personId),
    enabled: (options?.enabled ?? true) && !!personId,
    queryFn: () => invokeCrmPersonRecord<Record<string, unknown>>({
      action: "get_sources",
      person_id: personId,
    }),
  });
}

export function useCrmPersonUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { person_id: string; fields: Record<string, unknown>; unlock_fields?: string[] }) =>
      invokeCrmPersonRecord<{ person: Contact }>({
        action: "update_person",
        person_id: input.person_id,
        fields: input.fields,
        unlock_fields: input.unlock_fields,
      }),
    onSuccess: (_d, vars) => invalidateCrmPersonQueries(qc, vars.person_id),
  });
}

export function useCrmPersonAcceptName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { person_id: string; suggested_name: string }) =>
      invokeCrmPersonRecord<{ person: Contact }>({
        action: "accept_name_suggestion",
        person_id: input.person_id,
        suggested_name: input.suggested_name,
      }),
    onSuccess: (_d, vars) => invalidateCrmPersonQueries(qc, vars.person_id),
  });
}

export function useCrmPersonCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      person_id: string;
      body: string;
      company_id?: string | null;
      project_id?: string | null;
    }) => invokeCrmPersonRecord<{ activity: import("@/lib/types").Activity }>({
      action: "create_note",
      person_id: input.person_id,
      body: input.body,
      company_id: input.company_id,
      project_id: input.project_id,
    }),
    onSuccess: (_d, vars) => invalidateCrmPersonQueries(qc, vars.person_id),
  });
}

export function useCrmPersonLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      person_id: string;
      action: "suppress" | "restore" | "set_inactive" | "set_active" | "delete" | "merge" | "change_primary_company";
      company_id?: string;
      surviving_id?: string;
      merged_id?: string;
      permanent?: boolean;
    }) => {
      const actionMap = {
        suppress: "suppress_person",
        restore: "restore_person",
        set_inactive: "set_inactive",
        set_active: "set_inactive",
        delete: "delete_person",
        merge: "merge_person",
        change_primary_company: "change_primary_company",
      } as const;
      const body: Record<string, unknown> = {
        action: actionMap[input.action],
        person_id: input.person_id,
      };
      if (input.action === "set_active") body.inactive = false;
      if (input.action === "set_inactive") body.inactive = true;
      if (input.company_id) body.company_id = input.company_id;
      if (input.surviving_id) body.surviving_id = input.surviving_id;
      if (input.merged_id) body.merged_id = input.merged_id;
      if (input.permanent) body.permanent = true;
      return invokeCrmPersonRecord(body);
    },
    onSuccess: (_d, vars) => invalidateCrmPersonQueries(qc, vars.person_id),
  });
}

export function usePersonCompanies(personId?: string) {
  return useQuery({
    queryKey: ["person_companies", personId ?? "all"],
    enabled: !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_people")
        .select("*, clients(*)")
        .eq("person_id", personId!)
        .order("is_primary", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<import("@/lib/types").CompanyPerson & { clients: Client | null }>;
    },
  });
}

function invalidateInvoiceQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.invoices });
  qc.invalidateQueries({ queryKey: qk.invoiceMetrics });
  qc.invalidateQueries({ queryKey: qk.financeOverview });
  qc.invalidateQueries({ queryKey: qk.stripeConnection });
  qc.invalidateQueries({ queryKey: ["paid_revenue_reconciliation"] });
}

export function useStripeInvoiceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invoice_id: string; action: import("@/lib/types").StripeInvoiceActionType }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        invoice: InvoiceWithItems;
        already_done?: boolean;
        message?: string;
        error?: string;
      }>("stripe-invoice-action", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      if (data && "error" in data && data.error) throw new Error(data.error);
      return data!;
    },
    onSuccess: () => invalidateInvoiceQueries(qc),
  });
}

export function useUpdateInvoiceProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invoice_id: string; project_id: string | null }) => {
      const token = await getAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        invoice: InvoiceWithItems;
        stripe_metadata_warning?: string;
      }>("stripe-invoice-action", {
        body: input,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) await throwEdgeFunctionError(error);
      return data!;
    },
    onSuccess: () => {
      invalidateInvoiceQueries(qc);
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useDismissInvoiceAttention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invoice_id: string; reason?: string | null }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication required.");
      const { error } = await supabase.from("invoices").update({
        attention_dismissed_at: new Date().toISOString(),
        attention_dismissed_by: user.id,
        attention_dismiss_reason: input.reason ?? null,
      }).eq("id", input.invoice_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateInvoiceQueries(qc),
  });
}

export function useRestoreInvoiceAttention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoice_id: string) => {
      const { error } = await supabase.from("invoices").update({
        attention_dismissed_at: null,
        attention_dismissed_by: null,
        attention_dismiss_reason: null,
      }).eq("id", invoice_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateInvoiceQueries(qc),
  });
}
