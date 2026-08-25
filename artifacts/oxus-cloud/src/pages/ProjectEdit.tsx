import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, TextField, TextareaField, SelectField } from "@/components/forms/FormKit";
import { SearchableSelect } from "@/components/forms/SearchableSelect";
import { SearchableMultiSelect } from "@/components/forms/SearchableMultiSelect";
import { CurrencyInput, DatePicker } from "@/components/forms/Inputs";
import { ProjectDocuments } from "@/components/projects/ProjectDocuments";
import { ProjectImageField } from "@/components/projects/ProjectImageField";
import { ArrowLeft, Archive, RotateCcw, Trash2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  useProject,
  useUpdateProject,
  useDeleteProject,
  useArchiveProject,
  useRestoreProject,
  useClients,
  useEnrichProjectFromWebsite,
  useProjectClickupLink,
  useProjectSlackLinks,
  usePandaDocConnectionStatus,
} from "@/hooks/api";
import {
  useContactOptions,
  useOrganizationOptions,
  useTechnologyOptions,
  useUserOptions,
} from "@/components/forms/refOptions";
import { PROJECT_TYPES } from "@/lib/types";
import { isLikelyWebsiteUrl } from "@/lib/companyWebsite";
import { removeProjectImage, uploadProjectImage } from "@/lib/projectImage";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states/QueryStates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const SECTIONS = [
  { id: "details", label: "Project details" },
  { id: "contacts", label: "Client and contacts" },
  { id: "delivery", label: "Delivery settings" },
  { id: "dates", label: "Dates" },
  { id: "documents", label: "Documents" },
  { id: "integrations", label: "Integrations" },
  { id: "lifecycle", label: "Lifecycle" },
] as const;

export function ProjectEdit() {
  const params = useParams();
  const id = params.id as string;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isSuperAdmin, isPM } = useAuth();
  const canLifecycle = isSuperAdmin || isPM;

  const { data: project, isLoading, isError, error, refetch } = useProject(id);
  const update = useUpdateProject();
  const deleteProject = useDeleteProject();
  const archiveProject = useArchiveProject();
  const restoreProject = useRestoreProject();
  const enrichFromWebsite = useEnrichProjectFromWebsite();
  const { data: clients = [] } = useClients();
  const orgOptions = useOrganizationOptions();
  const contactOptions = useContactOptions();
  const techOptions = useTechnologyOptions();
  const userOptions = useUserOptions();
  const { data: clickupLink } = useProjectClickupLink(id);
  const { data: slackLinks = [] } = useProjectSlackLinks(id);
  const { data: pandadocStatus } = usePandaDocConnectionStatus({ enabled: isSuperAdmin });

  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [pointOfContactId, setPointOfContactId] = useState("");
  const [technologyId, setTechnologyId] = useState("");
  const [projectType, setProjectType] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"planning" | "in-progress" | "on-hold" | "completed">("planning");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [enrichConfirmOpen, setEnrichConfirmOpen] = useState(false);

  useEffect(() => {
    if (!project || hydrated) return;
    setName(project.name ?? "");
    setDescription(project.description ?? "");
    setCompanyWebsiteUrl(project.company_website_url ?? "");
    setOrganizationId(project.organization_id ?? "");
    setPointOfContactId(project.point_of_contact_id ?? "");
    setTechnologyId(project.technology_id ?? "");
    setProjectType(project.project_type ?? "");
    setBudget(project.budget || null);
    setProgress(project.progress ?? 0);
    setStatus(project.status);
    setPriority(project.priority);
    setStartDate(project.start_date ?? null);
    setDeadline(project.deadline ?? null);
    setOwnerId(project.owner_id ?? "");
    setTeamMembers(project.team_contacts.map((c) => c.id));
    setImagePath(project.image_path ?? null);
    setPendingImageFile(null);
    setRemoveExistingImage(false);
    setHydrated(true);
  }, [project, hydrated]);

  const snapshot = useMemo(() => {
    if (!project) return null;
    return {
      name: project.name ?? "",
      description: project.description ?? "",
      companyWebsiteUrl: project.company_website_url ?? "",
      organizationId: project.organization_id ?? "",
      pointOfContactId: project.point_of_contact_id ?? "",
      technologyId: project.technology_id ?? "",
      projectType: project.project_type ?? "",
      budget: project.budget || null,
      progress: project.progress ?? 0,
      status: project.status,
      priority: project.priority,
      startDate: project.start_date ?? null,
      deadline: project.deadline ?? null,
      ownerId: project.owner_id ?? "",
      teamMembers: project.team_contacts.map((c) => c.id).slice().sort().join(","),
      imageDirty: false,
    };
  }, [project]);

  const dirty = useMemo(() => {
    if (!snapshot) return false;
    return (
      name !== snapshot.name ||
      description !== snapshot.description ||
      companyWebsiteUrl !== snapshot.companyWebsiteUrl ||
      organizationId !== snapshot.organizationId ||
      pointOfContactId !== snapshot.pointOfContactId ||
      technologyId !== snapshot.technologyId ||
      projectType !== snapshot.projectType ||
      budget !== snapshot.budget ||
      progress !== snapshot.progress ||
      status !== snapshot.status ||
      priority !== snapshot.priority ||
      startDate !== snapshot.startDate ||
      deadline !== snapshot.deadline ||
      ownerId !== snapshot.ownerId ||
      teamMembers.slice().sort().join(",") !== snapshot.teamMembers ||
      !!pendingImageFile ||
      removeExistingImage
    );
  }, [
    snapshot, name, description, companyWebsiteUrl, organizationId, pointOfContactId,
    technologyId, projectType, budget, progress, status, priority, startDate, deadline,
    ownerId, teamMembers, pendingImageFile, removeExistingImage,
  ]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!project) return <div className="text-muted-foreground">Project not found.</div>;

  if (project.is_draft) {
    navigate(`/projects/${project.id}`);
    return null;
  }

  const websiteInvalid = companyWebsiteUrl.trim() !== "" && !isLikelyWebsiteUrl(companyWebsiteUrl);
  const orgName = clients.find((c) => c.id === organizationId)?.name ?? null;
  const archived = !!project.archived_at;

  const syncProjectImage = async (): Promise<string | null> => {
    if (removeExistingImage && imagePath) {
      await removeProjectImage(imagePath).catch(() => undefined);
      setImagePath(null);
      setRemoveExistingImage(false);
      return null;
    }
    if (pendingImageFile) {
      const path = await uploadProjectImage(id, pendingImageFile);
      setImagePath(path);
      setPendingImageFile(null);
      return path;
    }
    return imagePath;
  };

  const buildPatch = () => ({
    name: name.trim() || project.name,
    description: description || null,
    company_website_url: companyWebsiteUrl.trim() || null,
    client_id: organizationId || null,
    client_name: orgName,
    organization_id: organizationId || null,
    point_of_contact_id: pointOfContactId || null,
    technology_id: technologyId || null,
    project_type: projectType || null,
    budget: budget ?? 0,
    progress: Math.min(100, Math.max(0, progress)),
    status,
    priority,
    start_date: startDate || null,
    deadline: deadline || null,
    owner_id: ownerId || null,
  });

  const save = async (opts?: { queueEnrichment?: boolean }) => {
    if (!name.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    if (websiteInvalid) {
      toast({ title: "Company website URL looks invalid", variant: "destructive" });
      return;
    }
    try {
      const nextImage = await syncProjectImage();
      await update.mutateAsync({
        id,
        patch: { ...buildPatch(), image_path: nextImage },
        contact_assignee_ids: teamMembers,
      });

      const websiteChanged =
        (companyWebsiteUrl.trim() || null) !== (project.company_website_url ?? null);
      if (opts?.queueEnrichment && websiteChanged && companyWebsiteUrl.trim()) {
        enrichFromWebsite
          .mutateAsync({ project_id: id, company_website_url: companyWebsiteUrl.trim() })
          .then(() => toast({ title: "Company enrichment queued" }))
          .catch(() => undefined);
      }

      toast({ title: "Changes saved", description: name });
      setHydrated(false);
      await refetch();
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    }
  };

  const attemptSave = async () => {
    const websiteChanged =
      (companyWebsiteUrl.trim() || null) !== (project.company_website_url ?? null);
    if (websiteChanged && companyWebsiteUrl.trim() && isLikelyWebsiteUrl(companyWebsiteUrl)) {
      setEnrichConfirmOpen(true);
      return;
    }
    await save({ queueEnrichment: false });
  };

  const confirmArchive = async () => {
    try {
      await archiveProject.mutateAsync({ id, reason: archiveReason });
      toast({ title: "Project archived", description: "It is hidden from active project views." });
      navigate("/projects?filter=archived");
    } catch (e) {
      toast({ title: "Could not archive", description: (e as Error).message, variant: "destructive" });
    } finally {
      setArchiveOpen(false);
      setArchiveReason("");
    }
  };

  const confirmRestore = async () => {
    try {
      await restoreProject.mutateAsync({ id });
      toast({ title: "Project restored" });
      setRestoreOpen(false);
      await refetch();
    } catch (e) {
      toast({ title: "Could not restore", description: (e as Error).message, variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (deleteConfirm !== project.name) return;
    try {
      await deleteProject.mutateAsync({ id, image_path: project.image_path });
      toast({ title: "Project deleted" });
      navigate("/projects");
    } catch (e) {
      toast({ title: "Could not delete", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleteOpen(false);
      setDeleteConfirm("");
    }
  };

  const leave = (href: string) => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    navigate(href);
  };

  const busy = update.isPending || archiveProject.isPending || restoreProject.isPending || deleteProject.isPending;

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <PageHeader title="Edit Project" subtitle={project.name} />
          {archived && (
            <Badge variant="secondary" className="uppercase text-[10px]">Archived</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => leave(`/projects/${id}`)}>
            <ArrowLeft className="h-4 w-4" /> Back to Project
          </Button>
          <Button className="gap-2" disabled={!dirty || busy} onClick={() => void attemptSave()}>
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="hidden lg:block sticky top-20 self-start space-y-1">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="space-y-6">
          <Card id="details">
            <CardHeader>
              <CardTitle>Project details</CardTitle>
              <CardDescription>Core identity and classification for this project.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProjectImageField
                projectName={name}
                imagePath={removeExistingImage ? null : imagePath}
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
              <TextField label="Project name" value={name} onChange={setName} required />
              <TextareaField label="Description" value={description} onChange={setDescription} />
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField
                  label="Project type"
                  value={(projectType || "") as string}
                  onChange={setProjectType}
                  options={[{ value: "", label: "—" }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]}
                />
                <SelectField
                  label="Status"
                  value={status}
                  onChange={(v) => setStatus(v as typeof status)}
                  options={[
                    { value: "planning", label: "Planning" },
                    { value: "in-progress", label: "In progress" },
                    { value: "on-hold", label: "On hold" },
                    { value: "completed", label: "Completed" },
                  ]}
                />
                <SelectField
                  label="Priority"
                  value={priority}
                  onChange={(v) => setPriority(v as typeof priority)}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                />
                <Field label="Technology">
                  <SearchableSelect
                    value={technologyId}
                    onChange={setTechnologyId}
                    options={techOptions}
                    placeholder="Select technology"
                  />
                </Field>
              </div>
              <TextField
                label="Company website"
                value={companyWebsiteUrl}
                onChange={setCompanyWebsiteUrl}
                placeholder="https://"
              />
              {websiteInvalid && (
                <p className="text-xs text-destructive">Enter a valid website URL.</p>
              )}
            </CardContent>
          </Card>

          <Card id="contacts">
            <CardHeader>
              <CardTitle>Client and contacts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Client company">
                <SearchableSelect
                  value={organizationId}
                  onChange={setOrganizationId}
                  options={orgOptions}
                  placeholder="Select organization"
                />
              </Field>
              <Field label="Main point of contact">
                <SearchableSelect
                  value={pointOfContactId}
                  onChange={setPointOfContactId}
                  options={contactOptions}
                  placeholder="Select contact"
                />
              </Field>
              <Field label="Team contacts">
                <SearchableMultiSelect
                  values={teamMembers}
                  onChange={setTeamMembers}
                  options={contactOptions}
                  placeholder="Add contacts"
                />
              </Field>
            </CardContent>
          </Card>

          <Card id="delivery">
            <CardHeader>
              <CardTitle>Delivery settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Owner">
                <SearchableSelect
                  value={ownerId}
                  onChange={setOwnerId}
                  options={userOptions}
                  placeholder="Select owner"
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Budget (EUR)">
                  <CurrencyInput value={budget} onChange={setBudget} />
                </Field>
                <Field label="Progress (%)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={progress}
                    onChange={(e) => setProgress(Number(e.target.value) || 0)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card id="dates">
            <CardHeader>
              <CardTitle>Dates</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Start date">
                <DatePicker value={startDate} onChange={setStartDate} />
              </Field>
              <Field label="Deadline">
                <DatePicker value={deadline} onChange={setDeadline} />
              </Field>
              {archived && (
                <div className="md:col-span-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  Archived on {new Date(project.archived_at!).toLocaleString()}
                  {project.archive_reason ? ` — ${project.archive_reason}` : ""}
                </div>
              )}
            </CardContent>
          </Card>

          <Card id="documents">
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>
                MSA, NDA, Active SOW, uploads, and PandaDoc links in one place.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectDocuments projectId={id} />
            </CardContent>
          </Card>

          <Card id="integrations">
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>
                Compact status only. Manage account-level connections in Settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-sm font-medium">ClickUp</p>
                <p className="text-xs text-muted-foreground">
                  {clickupLink?.status === "active" ? "Linked" : "Not linked on this project"}
                </p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-sm font-medium">Slack</p>
                <p className="text-xs text-muted-foreground">
                  {slackLinks.some((l) => l.status === "active")
                    ? `${slackLinks.filter((l) => l.status === "active").length} channel(s)`
                    : "Not linked on this project"}
                </p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-sm font-medium">PandaDoc</p>
                <p className="text-xs text-muted-foreground">
                  {isSuperAdmin
                    ? (pandadocStatus?.configured ? (pandadocStatus.connected ? "Connected" : "Configured") : "Not configured")
                    : "Visible when linked to this project"}
                </p>
                {isSuperAdmin && (
                  <Link href="/settings/integrations#pandadoc-integration" className="text-xs text-primary hover:underline">
                    Open Settings
                  </Link>
                )}
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-sm font-medium">Company website</p>
                <p className="text-xs text-muted-foreground capitalize">
                  Enrichment: {project.company_enrichment_status?.replace(/_/g, " ") ?? "not started"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card id="lifecycle">
            <CardHeader>
              <CardTitle>Lifecycle</CardTitle>
              <CardDescription>
                Archive keeps history. Delete permanently removes the project.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canLifecycle && !archived && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">Archive project</p>
                    <p className="text-xs text-muted-foreground">
                      Hide from active views. Documents, timeline, and integrations remain.
                    </p>
                  </div>
                  <Button variant="outline" className="gap-2" onClick={() => setArchiveOpen(true)}>
                    <Archive className="h-4 w-4" /> Archive project
                  </Button>
                </div>
              )}
              {canLifecycle && archived && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">Restore project</p>
                    <p className="text-xs text-muted-foreground">Return this project to active views.</p>
                  </div>
                  <Button variant="outline" className="gap-2" onClick={() => setRestoreOpen(true)}>
                    <RotateCcw className="h-4 w-4" /> Restore project
                  </Button>
                </div>
              )}

              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-destructive">Danger zone</p>
                  <p className="text-xs text-muted-foreground">
                    Prefer Archive unless this is a test or mistake. Deletion removes documents, intelligence, timeline, and assignments.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" /> Delete project
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {dirty && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Unsaved changes</span>
          <Button size="sm" disabled={busy} onClick={() => void attemptSave()}>Save changes</Button>
        </div>
      )}

      <AlertDialog open={enrichConfirmOpen} onOpenChange={setEnrichConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refresh company enrichment?</AlertDialogTitle>
            <AlertDialogDescription>
              The company website changed. Save and queue Firecrawl enrichment, or save without refreshing enrichment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void save({ queueEnrichment: false })}>Save without refresh</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save({ queueEnrichment: true })}>Save and enrich</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this project?</AlertDialogTitle>
            <AlertDialogDescription>
              It will disappear from active project views. History, documents, Project Intelligence, timeline, ClickUp/Slack links, and financial records remain. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="archive-reason">Reason (optional)</Label>
            <Textarea id="archive-reason" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmArchive()}>Archive project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this project?</AlertDialogTitle>
            <AlertDialogDescription>
              The project will return to active views. Document links will not be duplicated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRestore()}>Restore project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Prefer Archive unless this is a test or mistake. Type <strong>{project.name}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={project.name} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirm !== project.name || deleteProject.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
