import React, { useState } from "react";

import { useParams, useLocation } from "wouter";

import { Card, CardContent } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";

import { Progress } from "@/components/ui/progress";

import { StatusBadge } from "@/components/StatusBadge";

import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";

import { AvatarStack } from "@/components/AvatarStack";

import { ArrowLeft, Calendar, Clock, Pencil, Tag, Trash2, User } from "lucide-react";

import { useDeleteProject, useProject, useProjectClickupLink } from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

import { ProjectWizard } from "@/pages/ProjectWizard";

import { ProjectDocuments } from "@/components/projects/ProjectDocuments";

import { CompanyLogo, CompanyEnrichmentBadge, CompanyEnrichmentDetails } from "@/components/projects/CompanyEnrichment";

import { ProjectIntelligencePanel } from "@/components/ai/ProjectIntelligencePanel";

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

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { formatEUR } from "@/lib/currency";

import { profileDisplayName } from "@/lib/profiles";

import { contactDisplayNames, contactInitials } from "@/lib/contacts";

import { ErrorState } from "@/components/states/QueryStates";

import { Skeleton } from "@/components/ui/skeleton";



function MetaTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}



export function ProjectDetail() {

  const params = useParams();

  const id = params.id as string;

  const [, navigate] = useLocation();
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const deleteProject = useDeleteProject();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

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



  const dateLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
  const clickupSpaceUrl = clickupLink?.status === "active" ? clickupLink.space_url : null;

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

  return (

    <div className="space-y-6">

      <div className="flex flex-wrap justify-end gap-2">

        <Button variant="outline" className="gap-2" onClick={() => navigate("/projects")}><ArrowLeft className="w-4 h-4" /> Projects</Button>

        <Button className="gap-2" onClick={() => navigate(`/projects/${project.id}/edit`)}><Pencil className="w-4 h-4" /> Edit</Button>

        <Button
          variant="outline"
          className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
          disabled={deleteProject.isPending}
        >
          <Trash2 className="w-4 h-4" />
          Delete project
        </Button>

      </div>



      <div className="grid gap-6 lg:grid-cols-3">

        <div className="lg:col-span-2 space-y-6">

          <Card className="overflow-hidden">

            <CardContent className="p-6 space-y-6">

              <div className="flex items-start justify-between gap-4">

                <div className="flex items-start gap-4 min-w-0">

                  <CompanyLogo project={project} />

                  <div className="min-w-0 space-y-3">

                    <h2 className="text-2xl font-bold tracking-tight text-foreground">{project.name}</h2>

                    <div className="flex flex-wrap items-center gap-2">

                      <StatusBadge status={project.status} className="uppercase text-[10px] tracking-wide" />

                      <ProjectHealthBadge health={project.health} />

                      <Badge variant="outline" className="uppercase text-[10px] tracking-wide bg-warm-yellow/15 text-warm-yellow border-warm-yellow/30">

                        {project.priority} priority

                      </Badge>

                      <CompanyEnrichmentBadge project={project} />

                    </div>

                  </div>

                </div>

                <div className="text-right shrink-0">

                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project Budget</p>

                  <p className="text-2xl font-bold font-sans text-foreground mt-1">{formatEUR(project.budget)}</p>

                </div>

              </div>



              {project.description && (

                <section className="space-y-2">

                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">About the Project</h3>

                  <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>

                </section>

              )}

              <CompanyEnrichmentDetails project={project} />



              <section className="space-y-2">

                <div className="flex items-center justify-between gap-2">

                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Phase Progress</h3>

                  <span className="text-sm font-semibold text-foreground">{project.progress}%</span>

                </div>

                <Progress value={project.progress} className="h-3 bg-muted [&>div]:bg-soft-green" />

              </section>



              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                <MetaTile icon={Tag} label="Project Type" value={project.project_type ?? "—"} />

                <MetaTile icon={User} label="Owner" value={project.owner ? profileDisplayName(project.owner) : "—"} />

                <MetaTile icon={Calendar} label="Start Date" value={dateLabel(project.start_date)} />

                <MetaTile icon={Clock} label="Deadline" value={dateLabel(project.deadline)} />

              </div>



              <div className="flex flex-col gap-4 border-t border-border/70 pt-5 sm:flex-row sm:items-end sm:justify-between">

                <div className="space-y-2">

                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Team Members</h3>

                  {project.team_contacts.length === 0 ? (

                    <p className="text-sm text-muted-foreground">No team members assigned yet.</p>

                  ) : (

                    <div className="flex items-center gap-3 flex-wrap">

                      <AvatarStack

                        urls={project.team_contacts.map(() => "")}

                        fallbacks={project.team_contacts.map((c) => contactInitials(c.name))}

                        size="md"

                        max={4}

                      />

                      <span className="text-sm text-muted-foreground">{contactDisplayNames(project.team_contacts)}</span>

                    </div>

                  )}

                </div>

                {clickupSpaceUrl && (

                  <Button variant="outline" className="shrink-0" asChild>

                    <a href={clickupSpaceUrl} target="_blank" rel="noopener noreferrer">

                      Manage Tasks

                    </a>

                  </Button>

                )}

              </div>

            </CardContent>

          </Card>



          {isSuperAdmin && (
            <Card>
              <CardContent className="p-6 space-y-4">
                <h3 className="section-label">Documents</h3>
                <ProjectDocuments projectId={project.id} />
              </CardContent>
            </Card>
          )}



          <Card className="border-t-[3px] border-t-soft-violet/50">

            <CardContent className="p-6 space-y-5">

              <ProjectIntelligencePanel projectId={project.id} />

            </CardContent>

          </Card>

        </div>



        <div className="space-y-6">

          <Card>

            <CardContent className="p-6 space-y-4">

              <ProjectTimelinePanel projectId={project.id} />

            </CardContent>

          </Card>



          <Card>

            <CardContent className="p-6 space-y-4">

              <ProjectSlackPanel projectId={project.id} />

            </CardContent>

          </Card>



          <Card>

            <CardContent className="p-6 space-y-4">

              <h3 className="section-label">ClickUp Execution</h3>

              <ProjectClickupPanel projectId={project.id} />

            </CardContent>

          </Card>



          <Card>

            <CardContent className="p-6 space-y-4">

              <ProjectExecutionNotesPanel projectId={project.id} />

            </CardContent>

          </Card>

        </div>

      </div>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteConfirm(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{project.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. All project-specific data will be deleted, including PM actions,
              Slack history, ClickUp links, AI briefs, and documents. Type the project name to confirm.
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


