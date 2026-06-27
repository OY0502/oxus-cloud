import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Activity,
  AiProjectBrief,
  AiProposedTask,
  Attachment,
  CalendarEventWithAttendees,
  Client,
  Comment,
  Contact,
  DocType,
  EntityType,
  Invoice,
  InvoiceWithItems,
  Profile,
  Project,
  ProjectWithAssignees,
  Quote,
  QuoteStage,
  QuoteWithRefs,
  Task,
  TeamMember,
  TeamMemberWithStats,
  Technology,
  Transaction,
  TransactionType,
  NewAiProjectBrief,
  UpdateAiProposedTaskStatus,
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
};

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as T;
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

export function useQuotes(): UseQueryResult<QuoteWithRefs[]> {
  return useQuery({
    queryKey: qk.quotes,
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

export function useProjects(): UseQueryResult<ProjectWithAssignees[]> {
  return useQuery({
    queryKey: qk.projects,
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

// --------------------------------------------------------------------------
// AI project briefs and proposed tasks
// --------------------------------------------------------------------------
export type CreateAiProjectBriefResult = {
  brief: AiProjectBrief;
  tasks: AiProposedTask[];
};

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
      if (error) throw new Error(error.message);
      if (!data) throw new Error("No AI brief was returned.");
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.aiProjectBriefs(vars.project_id) });
      qc.invalidateQueries({ queryKey: qk.aiProposedTasks(vars.project_id) });
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

// --------------------------------------------------------------------------
// Invoices (with line items)
// --------------------------------------------------------------------------
export function useInvoices(): UseQueryResult<InvoiceWithItems[]> {
  return useQuery({
    queryKey: qk.invoices,
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
export function useActivities(limit = 8): UseQueryResult<Activity[]> {
  return useQuery({
    queryKey: [...qk.activities, limit],
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
