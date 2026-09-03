import React, { useMemo } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProfiles, useSetProfileRole } from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { normalizeProfileRole, roleLabel } from "@/lib/roles";
import type { Contact, ProfileRole } from "@/lib/types";
import { TeamDetailGrid, TeamDetailItem, TeamPanelSection } from "./teamUi";

export function TeamMemberAccessPanel({ person }: { person: Contact }) {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { data: profiles = [], isLoading } = useProfiles();
  const setProfileRole = useSetProfileRole();

  const profile = useMemo(() => {
    const email = person.email?.trim().toLowerCase();
    if (!email) return null;
    return profiles.find((p) => p.email?.trim().toLowerCase() === email) ?? null;
  }, [profiles, person.email]);

  const superAdminCount = useMemo(
    () => profiles.filter((p) => normalizeProfileRole(p.role) === "super_admin").length,
    [profiles],
  );

  const handleRoleChange = async (role: ProfileRole) => {
    if (!profile) return;
    try {
      await setProfileRole.mutateAsync({ user_id: profile.id, role });
      if (profile.id === user?.id) await refreshProfile();
      toast({ title: "Role updated", description: `${roleLabel(role)} role saved.` });
    } catch (err) {
      toast({
        title: "Could not update role",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading workspace access…</p>;
  }

  if (!person.email) {
    return (
      <p className="text-sm text-muted-foreground">
        Add an email address to this member to manage workspace access.
      </p>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        No OXUS Cloud account is linked to <span className="text-foreground">{person.email}</span>.
        Invite them with this email to enable workspace access.
      </div>
    );
  }

  const role = normalizeProfileRole(profile.role);
  const isLastSuperAdmin = role === "super_admin" && superAdminCount <= 1;

  return (
    <div className="space-y-4">
      <TeamPanelSection title="Workspace account">
        <TeamDetailGrid>
          <TeamDetailItem label="Account">{profile.full_name ?? profile.email}</TeamDetailItem>
          <TeamDetailItem label="Email" className="col-span-2 sm:col-span-1">
            <span className="break-all">{profile.email}</span>
          </TeamDetailItem>
          <TeamDetailItem label="Status">
            <StatusBadge
              status={profile.access_status === "active" ? "Active" : profile.access_status}
              variant={profile.access_status === "active" ? "success" : "neutral"}
            />
          </TeamDetailItem>
        </TeamDetailGrid>

        <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Workspace role</p>
            <p className="text-xs text-muted-foreground">Controls finance and admin permissions</p>
          </div>
          <Select
            value={role}
            disabled={setProfileRole.isPending || isLastSuperAdmin}
            onValueChange={(v) => void handleRoleChange(v as ProfileRole)}
          >
            <SelectTrigger className="h-9 w-full sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pm">PM</SelectItem>
              <SelectItem value="super_admin">Super admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isLastSuperAdmin && (
          <p className="mt-3 text-xs text-muted-foreground">
            This is the last super admin account, so its role cannot be changed.
          </p>
        )}
      </TeamPanelSection>
    </div>
  );
}
