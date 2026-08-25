import React from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectAvatar } from "@/components/projects/ProjectAvatar";
import type { ProjectWithAssignees } from "@/lib/types";
import { cn } from "@/lib/utils";

interface UnscheduledProjectsListProps {
  projects: ProjectWithAssignees[];
  onOpen: (project: ProjectWithAssignees) => void;
  onEdit?: (project: ProjectWithAssignees) => void;
}

function missingLabel(project: ProjectWithAssignees): string {
  if (!project.start_date && !project.deadline) return "No dates";
  if (!project.start_date) return "No start date";
  return "No deadline";
}

export function UnscheduledProjectsList({ projects, onOpen, onEdit }: UnscheduledProjectsListProps) {
  if (projects.length === 0) return null;

  return (
    <section className="mt-6 space-y-3" aria-label="Unscheduled projects">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Unscheduled projects</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Projects missing a start date cannot be positioned on the timeline.
        </p>
      </div>
      <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
        {projects.map((project) => (
          <div
            key={project.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 bg-card hover:bg-muted/30 transition-colors",
              project.archived_at && "opacity-60",
            )}
          >
            <button type="button" className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => onOpen(project)}>
              <ProjectAvatar project={project} size="xs" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-xs text-muted-foreground">{missingLabel(project)}</p>
              </div>
            </button>
            {project.archived_at && (
              <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
                Archived
              </Badge>
            )}
            {onEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => onEdit(project)}
                aria-label={`Edit dates for ${project.name}`}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit dates
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
