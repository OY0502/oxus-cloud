import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectTimelineProgress } from "@/components/projects/ProjectTimelineProgress";
import { formatDateOnlyLong } from "@/lib/projectTimelineState";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";
import { AvatarStack } from "@/components/AvatarStack";
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Files,
  Plug,
  WalletCards,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  useArchiveProject,
  useDeleteProject,
  useProject,
  useProjectClickupLink,
  useRestoreProject,
} from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ProjectWizard } from "@/pages/ProjectWizard";
import { ProjectDocuments } from "@/components/projects/ProjectDocuments";
import { ProjectTeamCostSection } from "@/components/projects/ProjectTeamCostSection";
import { CompanyLogo } from "@/components/projects/CompanyEnrichment";
import { ProjectChat } from "@/components/projects/ProjectChat";
import { ProjectContextStatus } from "@/components/projects/ProjectContextStatus";
import { ProjectClickupPanel } from "@/components/clickup/ProjectClickupPanel";
import { ProjectExecutionNotesPanel } from "@/components/clickup/ProjectExecutionNotesPanel";
import { ProjectSlackPanel } from "@/components/slack/ProjectSlackPanel";
import { ProjectTimelinePanel } from "@/components/pm/ProjectTimelinePanel";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatEUR } from "@/lib/currency";
import { profileDisplayName } from "@/lib/profiles";
import { contactDisplayNames, contactInitials } from "@/lib/contacts";
import { ErrorState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type WorkspacePanel = "activity" | "files" | "connections" | "finance";

export function ProjectDetail() {
  const params = useParams();
  const id = params.id as string;
  const [, navigate] = useLocation();
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const deleteProject = useDeleteProject();
  const archiveProject = useArchiveProject();
  const restoreProject = useRestoreProject();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel | null>(null);

  const { data: project, isLoading, isError, error, refetch } = useProject(id);
  const { data: clickupLink = null } = useProjectClickupLink(id);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!project) return <div className="text-muted-foreground">Project not found.</div>;

  if (project.is_draft) {
    return <ProjectWizard projectId={id} />;
  }

  const archived = !!project.archived_at;
  const dateLabel = (iso: string | null) => formatDateOnlyLong(iso);
  const clickupSpaceUrl = clickupLink?.status === "active" ? clickupLink.space_url : null;
  const lifecyclePending =
    deleteProject.isPending || archiveProject.isPending || restoreProject.isPending;

  const confirmArchive = async () => {
    try {
      await archiveProject.mutateAsync({ id: project.id, reason: archiveReason });
      toast({ title: "Project archived", description: "It is hidden from active project views." });
      setArchiveOpen(false);
      setArchiveReason("");
      await refetch();
    } catch (e) {
      toast({
        title: "Could not archive project",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const confirmRestore = async () => {
    try {
      await restoreProject.mutateAsync({ id: project.id });
      toast({ title: "Project restored", description: "It is back in active project views." });
      setRestoreOpen(false);
      await refetch();
    } catch (e) {
      toast({
        title: "Could not restore project",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const confirmDelete = async () => {
    if (!project || deleteConfirm !== project.name) return;
    try {
      await deleteProject.mutateAsync({ id: project.id, image_path: project.image_path });
      toast({ title: "Project deleted", description: `"${project.name}" and its data were removed.` });
      navigate("/projects");
    } catch (e) {
      toast({
        title: "Could not delete project",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleteOpen(false);
      setDeleteConfirm("");
    }
  };

  const workspaceCopy: Record<WorkspacePanel, { title: string; description: string }> = {
    activity: {
      title: "Project activity",
      description: "The complete stream of meaningful ClickUp, Slack, and PM updates.",
    },
    files: {
      title: "Project files",
      description: "Documents and supporting project material.",
    },
    connections: {
      title: "Connected apps",
      description: "Slack and ClickUp delivery connections for this project.",
    },
    finance: {
      title: "Project finance",
      description: "Team cost and financial delivery detail.",
    },
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 xl:h-[calc(100dvh-8rem)] xl:overflow-hidden">
      {archived && (
        <div className="shrink-0 rounded-lg border border-warning/30 bg-warning-muted px-4 py-3 text-sm">
          <p className="font-semibold text-foreground">This project is archived</p>
          <p className="mt-1 text-muted-foreground">
            History, documents, and financial records remain available. Background delivery activity
            (syncs, alerts, and active-delivery actions) may be paused. Restore the project to return it
            to active views.
            {project.archive_reason ? ` Reason: ${project.archive_reason}` : ""}
          </p>
        </div>
      )}

      <Card className="shrink-0 overflow-hidden border-border bg-card shadow-none">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <CompanyLogo project={project} />
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="mr-1 truncate text-[22px] font-semibold tracking-tight text-foreground">{project.name}</h1>
                  <StatusBadge status={project.status} className="text-[11px]" />
                  {archived && <Badge variant="outline" className="bg-warning-muted text-warning-foreground">Archived</Badge>}
                  <ProjectHealthBadge health={project.health} />
                  <Badge variant="outline" className="border-warning/20 bg-warning-muted text-warning-foreground">
                    {project.priority} priority
                  </Badge>
                </div>
                {project.description && (
                  <p className="mt-2 max-w-4xl text-sm leading-5 text-muted-foreground line-clamp-2">
                    {project.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 self-end lg:self-start">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => navigate("/projects")}>
                <ArrowLeft className="h-4 w-4" /> Projects
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/projects/${project.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={lifecyclePending} aria-label="More project actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {!archived ? (
                    <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
                      <Archive className="h-4 w-4" /> Archive project
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => setRestoreOpen(true)}>
                      <RotateCcw className="h-4 w-4" /> Restore project
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 className="h-4 w-4" /> Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border/70 pt-3 text-sm">
            <div className="min-w-[120px]">
              <span className="text-xs text-muted-foreground">Owner</span>
              <p className="font-medium">{project.owner ? profileDisplayName(project.owner) : "Unassigned"}</p>
            </div>
            <div className="min-w-[220px]">
              <span className="text-xs text-muted-foreground">Timeline</span>
              <p className="font-medium">{dateLabel(project.start_date)} — {dateLabel(project.deadline)}</p>
            </div>
            <div className="min-w-[100px]">
              <span className="text-xs text-muted-foreground">Budget</span>
              <p className="font-medium tabular-nums">{formatEUR(project.budget)}</p>
            </div>
            <div className="min-w-[100px]">
              <span className="text-xs text-muted-foreground">Type</span>
              <p className="font-medium">{project.project_type ?? "Not set"}</p>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {project.team_contacts.length > 0 && (
                <AvatarStack
                  urls={project.team_contacts.map(() => "")}
                  fallbacks={project.team_contacts.map((contact) => contactInitials(contact.name))}
                  size="sm"
                  max={3}
                />
              )}
              <span className="truncate text-xs text-muted-foreground">
                {project.team_contacts.length > 0 ? contactDisplayNames(project.team_contacts) : "No team assigned"}
              </span>
            </div>
            <ProjectTimelineProgress
              startDate={project.start_date}
              deadline={project.deadline}
              status={project.status}
              archivedAt={project.archived_at}
              className="w-full max-w-[280px]"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,2.6fr)_minmax(320px,0.9fr)]">
        <ProjectChat projectId={project.id} className="min-h-[700px] xl:min-h-0" />

        <Card className="min-h-0 overflow-hidden border-border bg-card shadow-none">
          <CardContent className="flex h-full min-h-0 flex-col p-0">
            <div className="shrink-0 border-b border-border/70 p-4">
              <ProjectContextStatus projectId={project.id} compact />
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Recent activity</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Latest meaningful project changes</p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => setWorkspacePanel("activity")}>
                  View all <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              <ProjectTimelinePanel projectId={project.id} limit={4} compact />
            </div>

            <div className="shrink-0 border-t border-border/70 p-3">
              <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Project workspace</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["files", "Files", Files],
                  ["connections", "Apps", Plug],
                  ["finance", "Finance", WalletCards],
                ] as const).map(([panel, label, Icon]) => (
                  <button
                    key={panel}
                    type="button"
                    onClick={() => setWorkspacePanel(panel)}
                    className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/25 px-2 text-xs font-medium transition-colors hover:border-info/30 hover:bg-info-muted/60"
                  >
                    <Icon className="h-4 w-4 text-info" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Sheet open={workspacePanel !== null} onOpenChange={(open) => !open && setWorkspacePanel(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
          {workspacePanel && (
            <>
              <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background px-6 py-5 text-left">
                <SheetTitle>{workspaceCopy[workspacePanel].title}</SheetTitle>
                <SheetDescription>{workspaceCopy[workspacePanel].description}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 p-6">
                {workspacePanel === "activity" && (
                  <>
                    <ProjectTimelinePanel projectId={project.id} limit={30} />
                    <div className="border-t border-border pt-6">
                      <ProjectExecutionNotesPanel projectId={project.id} />
                    </div>
                  </>
                )}
                {workspacePanel === "files" && (
                  isSuperAdmin
                    ? <ProjectDocuments projectId={project.id} />
                    : <p className="text-sm text-muted-foreground">Project files are available to administrators.</p>
                )}
                {workspacePanel === "connections" && (
                  <>
                    <ProjectSlackPanel projectId={project.id} />
                    <div className="border-t border-border pt-6">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold">ClickUp execution</h3>
                        {clickupSpaceUrl && !archived && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={clickupSpaceUrl} target="_blank" rel="noopener noreferrer">Open ClickUp</a>
                          </Button>
                        )}
                      </div>
                      <ProjectClickupPanel projectId={project.id} />
                    </div>
                  </>
                )}
                {workspacePanel === "finance" && (
                  isSuperAdmin
                    ? <ProjectTeamCostSection projectId={project.id} />
                    : <p className="text-sm text-muted-foreground">Project financials are available to administrators.</p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={archiveOpen}
        onOpenChange={(open) => {
          setArchiveOpen(open);
          if (!open) setArchiveReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive &ldquo;{project.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              It will disappear from active project views. History, documents, Project Intelligence,
              timeline, ClickUp/Slack links, and financial records remain. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="archive-reason">Reason (optional)</Label>
            <Textarea
              id="archive-reason"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="Why is this project being archived?"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveProject.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmArchive();
              }}
              disabled={archiveProject.isPending}
            >
              {archiveProject.isPending ? "Archiving…" : "Archive project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore &ldquo;{project.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The project will return to active views. Document links will not be duplicated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreProject.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRestore();
              }}
              disabled={restoreProject.isPending}
            >
              {restoreProject.isPending ? "Restoring…" : "Restore project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteConfirm("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{project.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Prefer Archive unless this is a test or mistake — archive keeps
              history while hiding the project from active views. Deletion permanently removes
              project-specific data including PM actions, Slack history, ClickUp links, AI briefs, and
              documents. Type the project name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-project-confirm">Project name</Label>
            <Input
              id="delete-project-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={project.name}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleteProject.isPending || deleteConfirm !== project.name}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProject.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
