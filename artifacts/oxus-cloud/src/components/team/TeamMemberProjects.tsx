import React, { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/StatusBadge";
import { useEndProjectAssignment, usePersonProjectAssignments } from "@/hooks/api";
import { parseTeamMetadata } from "@/lib/team";
import { useToast } from "@/hooks/use-toast";
import type { Contact, ProjectContactAssignment } from "@/lib/types";
import { AssignProjectDialog } from "./TeamDialogs";
import { MoreHorizontal, Plus } from "lucide-react";
import {
  TeamEmptyState,
  TeamMiniStat,
  TeamOutlineButton,
  TeamPanelHeader,
  TeamRecordField,
  TeamRecordItem,
  TeamRecordList,
  teamActionBtn,
  teamIcon,
} from "./teamUi";

export function TeamMemberProjects({
  person,
  canManage,
}: {
  person: Contact;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const { data: assignments = [], isLoading } = usePersonProjectAssignments(person.id);
  const endAssignment = useEndProjectAssignment();
  const [assignOpen, setAssignOpen] = useState(false);
  const [editAssignment, setEditAssignment] = useState<ProjectContactAssignment | null>(null);
  const meta = parseTeamMetadata(person);

  const active = assignments.filter((a) => a.is_active !== false);
  const totalAllocation = active.reduce((s, a) => s + (Number(a.allocation_percent) || 0), 0);
  const totalWeekly = active.reduce((s, a) => s + (Number(a.weekly_hours) || 0), 0);
  const hasAllocationData = active.some((a) => a.allocation_percent != null || a.weekly_hours != null);

  const endProjectAssignment = (assignment: ProjectContactAssignment) => {
    void endAssignment.mutateAsync({ project_id: assignment.project_id, contact_id: person.id }).then(() => {
      toast({ title: "Assignment ended" });
    }).catch((e) => {
      toast({ title: "Could not end assignment", description: e.message, variant: "destructive" });
    });
  };

  return (
    <div className="space-y-4">
      <TeamPanelHeader
        title="Project assignments"
        action={
          canManage ? (
            <TeamOutlineButton onClick={() => { setEditAssignment(null); setAssignOpen(true); }}>
              <Plus className={teamIcon} /> Assign
            </TeamOutlineButton>
          ) : undefined
        }
      />

      <div className="grid grid-cols-3 gap-2">
        <TeamMiniStat
          label="Total capacity"
          value={meta.weekly_available_hours != null ? `${meta.weekly_available_hours}h/wk` : meta.capacity_percent != null ? `${meta.capacity_percent}%` : "—"}
        />
        <TeamMiniStat
          label="Allocated"
          value={hasAllocationData ? (totalWeekly > 0 ? `${totalWeekly}h/wk` : `${totalAllocation}%`) : "—"}
        />
        <TeamMiniStat
          label="Remaining"
          value={
            meta.weekly_available_hours != null && totalWeekly > 0
              ? `${Math.max(0, meta.weekly_available_hours - totalWeekly)}h/wk`
              : meta.capacity_percent != null && totalAllocation > 0
                ? `${Math.max(0, meta.capacity_percent - totalAllocation)}%`
                : "—"
          }
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading assignments…</p>
      ) : assignments.length === 0 ? (
        <TeamEmptyState
          title="No project assignments"
          description="Assign this member to a project to track role, dates, and capacity."
        />
      ) : (
        <TeamRecordList>
          {assignments.map((assignment) => {
            const isActive = assignment.is_active !== false;
            const allocation = assignment.allocation_percent != null
              ? `${assignment.allocation_percent}%`
              : assignment.weekly_hours != null
                ? `${assignment.weekly_hours}h / week`
                : "—";

            return (
              <TeamRecordItem
                key={`${assignment.project_id}-${assignment.contact_id}`}
                title={
                  <>
                    <Link href={`/projects/${assignment.project_id}`} className="hover:underline">
                      {assignment.projects?.name ?? assignment.project_id.slice(0, 8)}
                    </Link>
                    <StatusBadge status={isActive ? "Active" : "Ended"} variant={isActive ? "success" : "neutral"} />
                  </>
                }
                subtitle={assignment.role_on_project ?? "No project role set"}
                trailing={
                  <>
                    <div className="text-xs text-muted-foreground">Allocation</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{allocation}</div>
                  </>
                }
                details={
                  <>
                    <TeamRecordField label="Started">{assignment.start_date ?? "—"}</TeamRecordField>
                    <TeamRecordField label="Ended">{assignment.end_date ?? (isActive ? "Ongoing" : "—")}</TeamRecordField>
                  </>
                }
                actions={canManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className={teamActionBtn.menu} aria-label="Assignment actions">
                        <MoreHorizontal className={teamIcon} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => { setEditAssignment(assignment); setAssignOpen(true); }}>
                        Edit assignment
                      </DropdownMenuItem>
                      {isActive && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => endProjectAssignment(assignment)}>
                            End assignment
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : undefined}
              />
            );
          })}
        </TeamRecordList>
      )}

      <AssignProjectDialog
        open={assignOpen}
        onOpenChange={(o) => { setAssignOpen(o); if (!o) setEditAssignment(null); }}
        person={person}
        assignment={editAssignment}
      />
    </div>
  );
}
