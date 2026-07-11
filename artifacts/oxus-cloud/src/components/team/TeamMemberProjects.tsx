import React, { useState } from "react";
import { Link } from "wouter";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { useEndProjectAssignment, usePersonProjectAssignments } from "@/hooks/api";
import { parseTeamMetadata } from "@/lib/team";
import { useToast } from "@/hooks/use-toast";
import type { Contact, ProjectContactAssignment } from "@/lib/types";
import { AssignProjectDialog } from "./TeamDialogs";
import { Plus } from "lucide-react";
import { TeamMiniStat, TeamOutlineButton, TeamPanelHeader, teamIcon } from "./teamUi";

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

  const columns = [
    {
      id: "project",
      header: "Project",
      cell: (a: ProjectContactAssignment) => (
        <Link href={`/projects/${a.project_id}`} className="font-medium hover:underline">
          {a.projects?.name ?? a.project_id.slice(0, 8)}
        </Link>
      ),
    },
    { id: "role", header: "Role", cell: (a: ProjectContactAssignment) => a.role_on_project ?? "—" },
    {
      id: "allocation",
      header: "Allocation",
      cell: (a: ProjectContactAssignment) =>
        a.allocation_percent != null ? `${a.allocation_percent}%` : a.weekly_hours != null ? `${a.weekly_hours}h/wk` : "—",
    },
    { id: "start", header: "Start", cell: (a: ProjectContactAssignment) => a.start_date ?? "—" },
    { id: "end", header: "End", cell: (a: ProjectContactAssignment) => a.end_date ?? (a.is_active ? "Active" : "—") },
    ...(canManage
      ? [{
          id: "actions",
          header: "",
          cell: (a: ProjectContactAssignment) => (
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="ghost" onClick={() => { setEditAssignment(a); setAssignOpen(true); }}>Edit</Button>
              {a.is_active && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => void endAssignment.mutateAsync({ project_id: a.project_id, contact_id: person.id }).then(() => {
                    toast({ title: "Assignment ended" });
                  }).catch((e) => {
                    toast({ title: "Could not end assignment", description: e.message, variant: "destructive" });
                  })}
                >
                  End
                </Button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <TeamPanelHeader
        title="Projects"
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
        <p className="text-sm text-muted-foreground">No project assignments yet.</p>
      ) : (
        <DataTable tableId={`team-projects-${person.id}`} data={assignments} columns={columns} enablePagination={false} />
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
