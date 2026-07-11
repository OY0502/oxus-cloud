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
  payouts: (personId?: string) => ["payouts", personId ?? "all"] as const,
  expenses: ["expenses"] as const,
  stripeConnection: ["stripe_connection"] as const,
  companyMetrics: (companyId: string) => ["company_metrics", companyId] as const,
  teamMemberSummary: (personId: string) => ["team_member_summary", personId] as const,
  invoiceMetrics: ["invoice_metrics"] as const,
  financeOverview: ["finance_overview"] as const,
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
    mutationFn: async (input: { name: string; website?: string | null; industry?: string | null; notes?: string | null }) => {
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
export function useContacts(): UseQueryResult<Contact[]> {
  return useQuery({
    queryKey: qk.contacts,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.contacts }),
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
  "*, owner:profiles!owner_id(*), project_contact_assignees(contacts(*))";

function mapProject(p: any): ProjectWithAssignees {
  return {
    ...p,
    owner: (p.owner ?? null) as Profile | null,
    assignees: [],
    team_contacts: (p.project_contact_assignees ?? [])
      .map((pa: any) => pa.contacts)
      .filter(Boolean) as Contact[],
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

export async function getAttachmentUrl(filePath: string): Promise<string | null> {
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
          .update({ doc_type: "other", is_active: false })
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
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        uploaded_by: auth.user?.id ?? null,
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
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([a.file_path]);
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
        .order("issue_date", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((inv: any) => ({
        ...inv,
        line_items: (inv.invoice_line_items ?? []).sort((a: any, b: any) => a.position - b.position),
      })) as InvoiceWithItems[];
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
      priority?: AiProposedTaskPriority;
      status?: string;
      assignee_ids?: string[];
      due_date?: string;
      time_estimate_minutes?: number;
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
            due_date: input.due_date,
            time_estimate_minutes: input.time_estimate_minutes,
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
      priority?: AiProposedTaskPriority;
      status?: string;
      assignee_ids?: string[];
      due_date?: string;
      time_estimate_minutes?: number;
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
            due_date: input.due_date,
            time_estimate_minutes: input.time_estimate_minutes,
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
  value: AiProposedTaskPriority;
  label: string;
  clickup_value: number;
}

export interface ClickupListStatusesResult {
  linked: boolean;
  statuses: ClickupListStatusOption[];
  default_status?: string | null;
  priorities: ClickupPriorityOption[];
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
        supabase.from("projects").select("id, name, health, risk, status, is_draft").eq("is_draft", false),
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
export function useTeamMemberRates(personId: string) {
  return useQuery({
    queryKey: qk.teamMemberRates(personId),
    enabled: !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_member_rates")
        .select("*")
        .eq("person_id", personId)
        .order("effective_from", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as import("@/lib/types").TeamMemberRate[];
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
      const open = invoices.filter((i) => ["sent", "viewed", "partial", "overdue"].includes(i.status));

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
      const overdue = invoices
        .filter((i) => i.status === "overdue")
        .reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);

      const activeProjects = projects.filter((p) => p.status === "in-progress" || p.status === "planning").length;
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

export function useTeamMemberSummary(personId: string) {
  const ratesQuery = useTeamMemberRates(personId);
  const payoutsQuery = usePayouts(personId);
  const projectsQuery = useProjects();
  const companyPeopleQuery = useCompanyPeople();

  return useQuery({
    queryKey: qk.teamMemberSummary(personId),
    enabled: !!personId,
    queryFn: async () => {
      const rates = ratesQuery.data ?? [];
      const payouts = payoutsQuery.data ?? [];
      const today = new Date().toISOString().slice(0, 10);
      const currentRate = rates.find((r) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today)) ?? rates[0] ?? null;

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
      const pending = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount), 0);
      const lastPayment = paid.sort((a, b) => (b.payment_date ?? "").localeCompare(a.payment_date ?? ""))[0]?.payment_date ?? null;

      const rels = companyPeopleQuery.data ?? [];
      const isTeam = rels.some((r) => r.person_id === personId && ["employee", "contractor"].includes(r.relationship_type));
      const projects = projectsQuery.data ?? [];
      const activeProjects = isTeam ? projects.filter((p) => p.status === "in-progress").length : 0;

      return {
        paid_mtd: paidMtd,
        paid_ytd: paidYtd,
        pending,
        last_payment_date: lastPayment,
        current_rate: currentRate,
        active_projects: activeProjects,
      } satisfies import("@/lib/types").TeamMemberFinancialSummary;
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
      const { data, error } = await supabase.functions.invoke<import("@/lib/types").StripeSyncResult>(
        "stripe-sync-invoices",
        { body: input ?? {}, headers: { Authorization: `Bearer ${token}` } },
      );
      if (error) await throwEdgeFunctionError(error);
      if (!data) throw new Error("No sync result returned.");
      return data;
    },
    onSuccess: () => {
      invalidateInvoiceQueries(qc);
    },
  });
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
      const open = invoices.filter((i) => ["sent", "viewed", "partial", "overdue"].includes(i.status));
      const outstanding = open.reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);
      const overdue = invoices.filter((i) => i.status === "overdue").reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);
      const paidThisMonth = invoices
        .filter((i) => i.status === "paid")
        .filter((i) => {
          const d = new Date(i.paid_date ?? i.issue_date);
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
        .filter((i) => ["sent", "viewed", "partial", "overdue"].includes(i.status))
        .reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);

      const overdueReceivables = invoices
        .filter((i) => i.status === "overdue")
        .reduce((s, i) => s + (invoiceAmountDueEur(i) ?? 0), 0);

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

      const hasCostData = payouts.length > 0;
      const grossMargin = hasCostData ? revenueYtd - payoutsYtd : null;

      return {
        revenue_mtd: revenueMtd,
        revenue_ytd: revenueYtd,
        receivables,
        overdue_receivables: overdueReceivables,
        payouts_mtd: payoutsMtd,
        payouts_ytd: payoutsYtd,
        gross_margin: grossMargin,
        has_cost_data: hasCostData,
        revenue_by_client: Array.from(revenueByClient.entries()).map(([name, amount]) => ({ name, amount })),
        active_projects: projects.filter((p) => p.status === "in-progress").length,
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

function invalidateInvoiceQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.invoices });
  qc.invalidateQueries({ queryKey: qk.invoiceMetrics });
  qc.invalidateQueries({ queryKey: qk.financeOverview });
  qc.invalidateQueries({ queryKey: qk.stripeConnection });
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
