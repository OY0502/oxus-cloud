import React, { useMemo } from "react";
import { DataTable } from "@/components/DataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { useProfiles, useSetProfileRole } from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { normalizeProfileRole, roleLabel } from "@/lib/roles";
import type { Profile, ProfileRole } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

export function WorkspaceAccessTable() {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { data: profiles = [], isLoading } = useProfiles();
  const setProfileRole = useSetProfileRole();

  const superAdminCount = useMemo(
    () => profiles.filter((p) => normalizeProfileRole(p.role) === "super_admin").length,
    [profiles],
  );

  const handleRoleChange = async (userId: string, role: ProfileRole) => {
    try {
      await setProfileRole.mutateAsync({ user_id: userId, role });
      if (userId === user?.id) await refreshProfile();
      toast({ title: "Role updated", description: `${roleLabel(role)} role saved.` });
    } catch (err) {
      toast({
        title: "Could not update role",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      id: "user",
      header: "User",
      cell: (p: Profile) => (
        <div>
          <div className="font-medium">{p.full_name ?? p.email ?? "User"}</div>
          <div className="text-xs text-muted-foreground">{p.email ?? "—"}</div>
        </div>
      ),
    },
    {
      id: "role",
      header: "Workspace role",
      cell: (p: Profile) => {
        const role = normalizeProfileRole(p.role);
        const isSelf = p.id === user?.id;
        const isLastSuperAdmin = role === "super_admin" && superAdminCount <= 1;
        return (
          <Select
            value={role}
            disabled={setProfileRole.isPending || isLastSuperAdmin}
            onValueChange={(value) => void handleRoleChange(p.id, value as ProfileRole)}
          >
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pm">PM</SelectItem>
              <SelectItem value="super_admin">Super admin</SelectItem>
            </SelectContent>
          </Select>
        );
      },
    },
    {
      id: "status",
      header: "Account",
      cell: (p: Profile) => (
        <StatusBadge
          status={p.access_status}
          variant={p.access_status === "active" ? "success" : p.access_status === "pending" ? "warning" : "danger"}
        />
      ),
    },
    {
      id: "joined",
      header: "Joined",
      cell: (p: Profile) => new Date(p.created_at).toLocaleDateString(),
    },
    {
      id: "last_active",
      header: "Updated",
      cell: (p: Profile) => formatDistanceToNow(new Date(p.updated_at), { addSuffix: true }),
    },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading workspace users…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Manage OXUS Cloud login roles. Role changes run server-side; the last super admin cannot be demoted.
      </p>
      <DataTable tableId="team-workspace-access" data={profiles} columns={columns} />
      {superAdminCount <= 1 && (
        <p className="text-xs text-muted-foreground">
          Promote another user to super admin before demoting the last one.
        </p>
      )}
    </div>
  );
}
