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
import { ProjectImageField } from "@/components/projects/ProjectImageField";
import { Check, FileText, Info, ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useProject, useCreateProject, useUpdateProject, useDeleteProject, useClients, useEnrichProjectFromWebsite } from "@/hooks/api";
import {
  useContactOptions,
  useOrganizationOptions,
  useTechnologyOptions,
  useUserOptions,
} from "@/components/forms/refOptions";
import { PROJECT_TYPES } from "@/lib/types";
import { isLikelyWebsiteUrl } from "@/lib/companyWebsite";
import { cn } from "@/lib/utils";
import { removeProjectImage, uploadProjectImage } from "@/lib/projectImage";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const { isSuperAdmin } = useAuth();

  const routeId = (params.id as string | undefined) ?? projectIdProp;
  const [projectId, setProjectId] = useState<string | undefined>(routeId);
  const existing = useProject(projectId);

  const create = useCreateProject();
  const update = useUpdateProject();
  const deleteProject = useDeleteProject();
  const enrichFromWebsite = useEnrichProjectFromWebsite();
  const { data: clients = [] } = useClients();
  const orgOptions = useOrganizationOptions();
  const contactOptions = useContactOptions();
  const techOptions = useTechnologyOptions();
  const userOptions = useUserOptions();

  const [step, setStep] = useState(1);
  const [hydrated, setHydrated] = useState(!routeId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState("");
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
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);

  // Whether we are editing a project that has already been finished (not a draft).
  const isCompleted = !!existing.data && !existing.data.is_draft;

  useEffect(() => {
    if (existing.data && !hydrated) {
      const p = existing.data;
      setName(p.name ?? "");
      setDescription(p.description ?? "");
      setCompanyWebsiteUrl(p.company_website_url ?? "");
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
      setImagePath(p.image_path ?? null);
      setPendingImageFile(null);
      setRemoveExistingImage(false);
      setStep(p.draft_step && p.draft_step > 1 ? p.draft_step : 1);
      setHydrated(true);
    }
  }, [existing.data, hydrated]);

  const orgName = clients.find((c) => c.id === organizationId)?.name ?? null;

  const syncProjectImage = async (id: string): Promise<string | null> => {
    if (removeExistingImage && imagePath) {
      await removeProjectImage(imagePath).catch(() => undefined);
      await update.mutateAsync({ id, patch: { image_path: null } });
      setImagePath(null);
      setRemoveExistingImage(false);
      return null;
    }
    if (pendingImageFile) {
      const path = await uploadProjectImage(id, pendingImageFile);
      await update.mutateAsync({ id, patch: { image_path: path } });
      setImagePath(path);
      setPendingImageFile(null);
      return path;
    }
    return imagePath;
  };

  const websiteInvalid = companyWebsiteUrl.trim() !== "" && !isLikelyWebsiteUrl(companyWebsiteUrl);

  const buildPatch = (draftStep: number) => ({
    name: name || "Untitled project",
    description: description || null,
    company_website_url: companyWebsiteUrl.trim() || null,
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
    let id: string;
    if (projectId) {
      await update.mutateAsync({ id: projectId, patch: { ...buildPatch(draftStep), is_draft: isDraft }, contact_assignee_ids: teamMembers });
      id = projectId;
    } else {
      const project = await create.mutateAsync({ ...buildPatch(draftStep), is_draft: true, contact_assignee_ids: teamMembers });
      setProjectId(project.id);
      id = project.id;
    }
    await syncProjectImage(id);
    return id;
  };

  // Queue server-side Firecrawl enrichment when a website is present and it hasn't
  // been enriched yet, or the URL changed. Fire-and-forget: never block or fail saves.
  const maybeQueueEnrichment = (id: string) => {
    const website = companyWebsiteUrl.trim();
    if (!website || websiteInvalid) return;
    const previousWebsite = existing.data?.company_website_url ?? null;
    const status = existing.data?.company_enrichment_status ?? "not_started";
    const alreadyEnriched = status !== "not_started" && status !== "failed" && previousWebsite === website;
    if (alreadyEnriched) return;
    enrichFromWebsite
      .mutateAsync({ project_id: id, company_website_url: website })
      .then((r) => {
        toast({
          title: r.async ? "Company enrichment queued" : "Company enrichment started",
          description: "We're reading the company website to enrich this project.",
        });
      })
      .catch((e) => {
        // Enrichment must never break project creation.
        console.warn("[enrichment] queue failed", (e as Error).message);
      });
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
      maybeQueueEnrichment(id);
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
      maybeQueueEnrichment(id);
      toast({ title: "Project created", description: name });
      navigate(`/projects/${id}`);
    } catch (e) {
      toast({ title: "Couldn't finish", description: (e as Error).message, variant: "destructive" });
    }
  };

  const busy = create.isPending || update.isPending || deleteProject.isPending;

  const confirmDeleteDraft = async () => {
    if (!projectId) return;
    try {
      await deleteProject.mutateAsync({ id: projectId, image_path: imagePath });
      toast({ title: "Draft deleted" });
      navigate("/projects");
    } catch (e) {
      toast({
        title: "Could not delete draft",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleteOpen(false);
    }
  };

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

      <Card>
        <CardContent className="p-6 space-y-4">
          {step === 1 ? (
            <>
              <ProjectImageField
                projectName={name}
                imagePath={imagePath}
                pendingFile={pendingImageFile}
                onImagePathChange={(path) => {
                  setImagePath(path);
                  if (!path) setRemoveExistingImage(true);
                }}
                onFileSelected={(file) => {
                  setPendingImageFile(file);
                  if (file) setRemoveExistingImage(false);
                }}
                disabled={busy}
              />
              <TextField label="Project name" value={name} onChange={setName} required placeholder="Acme Marketing Website" />
              <TextareaField label="Project description" value={description} onChange={setDescription} placeholder="Short summary of the work and goals…" />

              <div className="space-y-1">
                <TextField
                  label="Company website (recommended)"
                  value={companyWebsiteUrl}
                  onChange={setCompanyWebsiteUrl}
                  type="url"
                  placeholder="https://acme.com"
                />
                <p className="text-xs text-muted-foreground">
                  Optional but recommended. We read this exact site server-side to auto-enrich the company logo, description, and details.
                </p>
                {websiteInvalid && (
                  <p className="text-xs text-soft-red">Enter a valid URL, e.g. https://acme.com.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Organization">
                  <SearchableSelect
                    value={organizationId}
                    onChange={setOrganizationId}
                    options={orgOptions}
                    placeholder="Select an organization"
                    footerLabel={isSuperAdmin ? "Add new organization" : undefined}
                    onFooterClick={isSuperAdmin ? () => navigate("/contacts?tab=organizations&new=1") : undefined}
                  />
                </Field>
                <Field label="Point of Contact">
                  <SearchableSelect
                    value={pointOfContactId}
                    onChange={setPointOfContactId}
                    options={contactOptions}
                    placeholder="Select a person"
                    footerLabel={isSuperAdmin ? "Add new person" : undefined}
                    onFooterClick={isSuperAdmin ? () => navigate("/contacts?tab=people&new=1") : undefined}
                  />
                </Field>
              </div>
              {!isSuperAdmin && (
                <p className="text-xs text-muted-foreground -mt-2">
                  Need a new client or contact? Ask a super admin to add them first.
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Technology">
                  <SearchableSelect
                    value={technologyId}
                    onChange={setTechnologyId}
                    options={techOptions}
                    placeholder="Select a technology"
                    footerLabel={isSuperAdmin ? "Manage technologies" : undefined}
                    onFooterClick={isSuperAdmin ? () => navigate("/technologies") : undefined}
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
                    footerLabel={isSuperAdmin ? "Add new person" : undefined}
                    onFooterClick={isSuperAdmin ? () => navigate("/contacts?tab=people&new=1") : undefined}
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

      {projectId && !isCompleted && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive gap-2"
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
          >
            <Trash2 className="w-4 h-4" />
            Delete draft
          </Button>
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft and any uploaded documents will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteDraft();
              }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
