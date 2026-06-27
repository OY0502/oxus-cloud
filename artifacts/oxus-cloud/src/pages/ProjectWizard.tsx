import React, { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, TextField, TextareaField, SelectField } from "@/components/forms/FormKit";
import { SearchableSelect } from "@/components/forms/SearchableSelect";
import { SearchableMultiSelect } from "@/components/forms/SearchableMultiSelect";
import { CurrencyInput, DatePicker } from "@/components/forms/Inputs";
import { ProjectDocuments } from "@/components/projects/ProjectDocuments";
import { Check, FileText, Info, ArrowLeft, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProject, useCreateProject, useUpdateProject, useClients } from "@/hooks/api";
import {
  useContactOptions,
  useOrganizationOptions,
  useTechnologyOptions,
  useUserOptions,
} from "@/components/forms/refOptions";
import { PROJECT_TYPES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const STEPS = [
  { n: 1, label: "Main info", icon: Info },
  { n: 2, label: "Documents", icon: FileText },
];

interface ProjectWizardProps {
  projectId?: string;
}

export function ProjectWizard({ projectId: projectIdProp }: ProjectWizardProps) {
  const params = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const routeId = (params.id as string | undefined) ?? projectIdProp;
  const [projectId, setProjectId] = useState<string | undefined>(routeId);
  const existing = useProject(projectId);

  const create = useCreateProject();
  const update = useUpdateProject();
  const { data: clients = [] } = useClients();
  const orgOptions = useOrganizationOptions();
  const contactOptions = useContactOptions();
  const techOptions = useTechnologyOptions();
  const userOptions = useUserOptions();

  const [step, setStep] = useState(1);
  const [hydrated, setHydrated] = useState(!routeId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [pointOfContactId, setPointOfContactId] = useState("");
  const [technologyId, setTechnologyId] = useState("");
  const [projectType, setProjectType] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const [status, setStatus] = useState<"planning" | "in-progress" | "on-hold" | "completed">("planning");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [teamMembers, setTeamMembers] = useState<string[]>([]);

  // Whether we are editing a project that has already been finished (not a draft).
  const isCompleted = !!existing.data && !existing.data.is_draft;

  useEffect(() => {
    if (existing.data && !hydrated) {
      const p = existing.data;
      setName(p.name ?? "");
      setDescription(p.description ?? "");
      setOrganizationId(p.organization_id ?? "");
      setPointOfContactId(p.point_of_contact_id ?? "");
      setTechnologyId(p.technology_id ?? "");
      setProjectType(p.project_type ?? "");
      setBudget(p.budget || null);
      setStatus(p.status);
      setPriority(p.priority);
      setStartDate(p.start_date ?? null);
      setDeadline(p.deadline ?? null);
      setOwnerId(p.owner_id ?? "");
      setTeamMembers(p.team_contacts.map((c) => c.id));
      setStep(p.draft_step && p.draft_step > 1 ? p.draft_step : 1);
      setHydrated(true);
    }
  }, [existing.data, hydrated]);

  const orgName = clients.find((c) => c.id === organizationId)?.name ?? null;

  const buildPatch = (draftStep: number) => ({
    name: name || "Untitled project",
    description: description || null,
    client_id: organizationId || null,
    client_name: orgName,
    organization_id: organizationId || null,
    point_of_contact_id: pointOfContactId || null,
    technology_id: technologyId || null,
    project_type: projectType || null,
    budget: budget ?? 0,
    status,
    priority,
    start_date: startDate || null,
    deadline: deadline || null,
    owner_id: ownerId || null,
    draft_step: draftStep,
  });

  // Ensure a row exists so step 2 (documents) has an entity to attach to.
  // Preserve the draft flag of an existing project (don't flip a finished one back to draft).
  const ensureSaved = async (draftStep: number): Promise<string> => {
    const isDraft = existing.data ? existing.data.is_draft : true;
    if (projectId) {
      await update.mutateAsync({ id: projectId, patch: { ...buildPatch(draftStep), is_draft: isDraft }, contact_assignee_ids: teamMembers });
      return projectId;
    }
    const project = await create.mutateAsync({ ...buildPatch(draftStep), is_draft: true, contact_assignee_ids: teamMembers });
    setProjectId(project.id);
    return project.id;
  };

  const goToDocuments = async () => {
    try {
      await ensureSaved(2);
      setStep(2);
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    }
  };

  const saveDraft = async () => {
    try {
      await ensureSaved(step);
      toast({ title: "Draft saved", description: "You can finish setting this project up later." });
      navigate("/projects");
    } catch (e) {
      toast({ title: "Couldn't save draft", description: (e as Error).message, variant: "destructive" });
    }
  };

  // Save changes for a finished project (no draft semantics).
  const saveChanges = async () => {
    try {
      const id = await ensureSaved(2);
      await update.mutateAsync({ id, patch: { is_draft: false }, contact_assignee_ids: teamMembers });
      toast({ title: "Project updated", description: name });
      navigate(`/projects/${id}`);
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    }
  };

  const finish = async () => {
    try {
      const id = await ensureSaved(2);
      await update.mutateAsync({ id, patch: { is_draft: false, draft_step: 2 } });
      toast({ title: "Project created", description: name });
      navigate(`/projects/${id}`);
    } catch (e) {
      toast({ title: "Couldn't finish", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy = create.isPending || update.isPending;

  if (routeId && existing.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title={isCompleted ? "Edit Project" : routeId ? "Edit Project Draft" : "New Project"}
        subtitle={isCompleted ? "Update the project details and documents." : "Set up the project in two quick steps. Drafts are saved automatically."}
        actions={<Button variant="outline" className="gap-2" onClick={() => navigate("/projects")}><ArrowLeft className="w-4 h-4" /> Projects</Button>}
      />

      <div className="flex items-center gap-4">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.n}>
            <button
              onClick={() => { if (s.n === 1) setStep(1); else if (projectId) setStep(2); }}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                step === s.n ? "bg-primary text-primary-foreground" : step > s.n ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background/30 text-xs">
                {step > s.n ? <Check className="h-3 w-3" /> : s.n}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </React.Fragment>
        ))}
      </div>

      <Card className="bg-card border-border shadow-sm">
        <CardContent className="p-6 space-y-4">
          {step === 1 ? (
            <>
              <TextField label="Project name" value={name} onChange={setName} required placeholder="Acme Marketing Website" />
              <TextareaField label="Project description" value={description} onChange={setDescription} placeholder="Short summary of the work and goals…" />

              <div className="grid grid-cols-2 gap-4">
                <Field label="Organization">
                  <SearchableSelect
                    value={organizationId}
                    onChange={setOrganizationId}
                    options={orgOptions}
                    placeholder="Select an organization"
                    footerLabel="Add new organization"
                    onFooterClick={() => navigate("/contacts?tab=organizations&new=1")}
                  />
                </Field>
                <Field label="Point of Contact">
                  <SearchableSelect
                    value={pointOfContactId}
                    onChange={setPointOfContactId}
                    options={contactOptions}
                    placeholder="Select a person"
                    footerLabel="Add new person"
                    onFooterClick={() => navigate("/contacts?tab=people&new=1")}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Technology">
                  <SearchableSelect
                    value={technologyId}
                    onChange={setTechnologyId}
                    options={techOptions}
                    placeholder="Select a technology"
                    footerLabel="Manage technologies"
                    onFooterClick={() => navigate("/technologies")}
                  />
                </Field>
                <SelectField
                  label="Project type"
                  value={projectType}
                  onChange={setProjectType}
                  options={[{ value: "", label: "— Select —" }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Status" value={status} onChange={setStatus} options={[
                  { value: "planning", label: "Planning" },
                  { value: "in-progress", label: "In Progress" },
                  { value: "on-hold", label: "On Hold" },
                  { value: "completed", label: "Completed" },
                ]} />
                <SelectField label="Priority" value={priority} onChange={setPriority} options={[
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                ]} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Start date">
                  <DatePicker value={startDate} onChange={setStartDate} placeholder="Pick a start date" />
                </Field>
                <Field label="Deadline">
                  <DatePicker value={deadline} onChange={setDeadline} placeholder="Pick a deadline" />
                </Field>
              </div>

              <Field label="Budget">
                <CurrencyInput value={budget} onChange={setBudget} placeholder="20,000.00" />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Owner">
                  <SearchableSelect
                    value={ownerId}
                    onChange={setOwnerId}
                    options={userOptions}
                    placeholder="Select an owner"
                    searchPlaceholder="Search team…"
                    emptyText="No users found."
                  />
                </Field>
                <Field label="Team members">
                  <SearchableMultiSelect
                    values={teamMembers}
                    onChange={setTeamMembers}
                    options={contactOptions}
                    placeholder="Add people…"
                    searchPlaceholder="Search people…"
                    emptyText="No people found."
                    footerLabel="Add new person"
                    onFooterClick={() => navigate("/contacts?tab=people&new=1")}
                  />
                </Field>
              </div>

              <div className="flex justify-between pt-2">
                {isCompleted ? (
                  <>
                    <Button variant="outline" onClick={() => navigate(`/projects/${projectId}`)} disabled={busy}>Cancel</Button>
                    <div className="flex gap-3">
                      <Button variant="ghost" className="gap-2" onClick={goToDocuments} disabled={!name.trim() || busy}>
                        Documents <ArrowRight className="w-4 h-4" />
                      </Button>
                      <Button onClick={saveChanges} disabled={!name.trim() || busy}>Save changes</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" onClick={saveDraft} disabled={busy}>Save draft</Button>
                    <Button className="gap-2" onClick={goToDocuments} disabled={!name.trim() || busy}>
                      Continue <ArrowRight className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Project documents</h3>
                <p className="text-sm text-muted-foreground">Upload the standardized documents for this engagement. All documents are optional.</p>
              </div>

              {projectId ? (
                <ProjectDocuments projectId={projectId} />
              ) : (
                <p className="text-sm text-muted-foreground">Save the first step to start uploading documents.</p>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" className="gap-2" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4" /> Back</Button>
                <div className="flex gap-3">
                  {isCompleted ? (
                    <Button onClick={saveChanges} disabled={busy}>Save changes</Button>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={saveDraft} disabled={busy}>Save draft</Button>
                      <Button onClick={finish} disabled={busy}>Finish</Button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
