import React from "react";
import { useParams, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";
import { AvatarStack } from "@/components/AvatarStack";
import { ArrowLeft, Calendar, Pencil } from "lucide-react";
import { useProject } from "@/hooks/api";
import { ProjectWizard } from "@/pages/ProjectWizard";
import { ProjectDocuments } from "@/components/projects/ProjectDocuments";
import { CommentsPanel, TasksPanel } from "@/components/collab/CollabPanels";
import { ProjectAiBriefPanel } from "@/components/ai/ProjectAiBriefPanel";
import { formatEUR } from "@/lib/currency";
import { profileDisplayName } from "@/lib/profiles";
import { contactDisplayNames, contactInitials } from "@/lib/contacts";
import { ErrorState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
      <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1 block">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function ProjectDetail() {
  const params = useParams();
  const id = params.id as string;
  const [, navigate] = useLocation();
  const { data: project, isLoading, isError, error, refetch } = useProject(id);

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

  // Drafts open straight into the multi-step wizard for completion.
  if (project.is_draft) {
    return <ProjectWizard projectId={id} />;
  }

  const dateLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        subtitle={project.client_name ?? "—"}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate("/projects")}><ArrowLeft className="w-4 h-4" /> Projects</Button>
            <Button className="gap-2" onClick={() => navigate(`/projects/${project.id}/edit`)}><Pencil className="w-4 h-4" /> Edit</Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <StatusBadge status={project.status} />
                  <ProjectHealthBadge health={project.health} />
                  <Badge variant="outline" className="capitalize">{project.priority} priority</Badge>
                </div>
                <div className="text-2xl font-bold font-sans">{formatEUR(project.budget)}</div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{project.progress}%</span>
                </div>
                <Progress value={project.progress} />
              </div>

              {project.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Detail label="Project Type" value={project.project_type ?? "—"} />
                <Detail label="Owner" value={project.owner ? profileDisplayName(project.owner) : "—"} />
                <Detail label="Start Date" value={<span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-muted-foreground" />{dateLabel(project.start_date)}</span>} />
                <Detail label="Deadline" value={<span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-muted-foreground" />{dateLabel(project.deadline)}</span>} />
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3">Team members</h4>
                {project.team_contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No team members assigned yet.</p>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    <AvatarStack
                      urls={project.team_contacts.map(() => "")}
                      fallbacks={project.team_contacts.map((c) => contactInitials(c.name))}
                      size="md"
                    />
                    <span className="text-sm text-muted-foreground">{contactDisplayNames(project.team_contacts)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Documents</h3>
              <ProjectDocuments projectId={project.id} />
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Comments</h3>
              <CommentsPanel entityType="project" entityId={project.id} />
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">AI Project Brief</h3>
              <ProjectAiBriefPanel projectId={project.id} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Tasks</h3>
              <TasksPanel entityType="project" entityId={project.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
