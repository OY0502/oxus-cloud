import React, { useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  useProfiles,
  useSetProfileRole,
  useSetProfileAccessStatus,
  useDeleteWorkspaceUser,
} from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { normalizeProfileRole, roleLabel } from "@/lib/roles";
import type { Profile, ProfileRole } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { Ban, MoreHorizontal, Trash2, UserCheck } from "lucide-react";

type PendingAction =
  | { type: "deactivate"; profile: Profile }
  | { type: "activate"; profile: Profile }
  | { type: "delete"; profile: Profile };

function accessStatusLabel(status: Profile["access_status"]): string {
  if (status === "active") return "Active";
  if (status === "blocked") return "Deactivated";
  if (status === "pending") return "Pending";
  return status;
}

function accessStatusVariant(status: Profile["access_status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  if (status === "blocked") return "danger";
  return "neutral";
}

function deleteConfirmationText(profile: Profile): string {
  return `DELETE ${profile.email ?? profile.full_name ?? "user"}`;
}

export function WorkspaceAccessTable() {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const { data: profiles = [], isLoading } = useProfiles();
  const setProfileRole = useSetProfileRole();
  const setProfileAccessStatus = useSetProfileAccessStatus();
  const deleteWorkspaceUser = useDeleteWorkspaceUser();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const superAdminCount = useMemo(
    () => profiles.filter((p) => normalizeProfileRole(p.role) === "super_admin" && p.access_status === "active").length,
    [profiles],
  );

  const isBusy = setProfileRole.isPending || setProfileAccessStatus.isPending || deleteWorkspaceUser.isPending;

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

  const runPendingAction = async () => {
    if (!pendingAction) return;

    try {
      if (pendingAction.type === "deactivate") {
        await setProfileAccessStatus.mutateAsync({
          user_id: pendingAction.profile.id,
          access_status: "blocked",
        });
        toast({
          title: "User deactivated",
          description: `${pendingAction.profile.email ?? pendingAction.profile.full_name ?? "User"} can no longer sign in.`,
        });
      } else if (pendingAction.type === "activate") {
        await setProfileAccessStatus.mutateAsync({
          user_id: pendingAction.profile.id,
          access_status: "active",
        });
        toast({
          title: "User reactivated",
          description: `${pendingAction.profile.email ?? pendingAction.profile.full_name ?? "User"} can sign in again.`,
        });
      } else if (pendingAction.type === "delete") {
        const expected = deleteConfirmationText(pendingAction.profile);
        if (deleteConfirmText.trim() !== expected) {
          toast({
            title: "Confirmation did not match",
            description: `Type exactly: ${expected}`,
            variant: "destructive",
          });
          return;
        }
        await deleteWorkspaceUser.mutateAsync(pendingAction.profile.id);
        toast({
          title: "User deleted",
          description: "The login account and profile were permanently removed.",
        });
      }
      setPendingAction(null);
      setDeleteConfirmText("");
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const canManageProfile = (profile: Profile) => {
    if (profile.id === user?.id) return false;
    const role = normalizeProfileRole(profile.role);
    const isLastSuperAdmin = role === "super_admin" && superAdminCount <= 1;
    return !isLastSuperAdmin;
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
        const isLastSuperAdmin = role === "super_admin" && superAdminCount <= 1;
        return (
          <Select
            value={role}
            disabled={isBusy || isLastSuperAdmin}
            onValueChange={(value) => void handleRoleChange(p.id, value as ProfileRole)}
          >
            <SelectTrigger className="h-8 w-[140px]">
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
          status={accessStatusLabel(p.access_status)}
          variant={accessStatusVariant(p.access_status)}
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
    {
      id: "actions",
      header: "",
      align: "right" as const,
      cell: (p: Profile) => {
        const manageable = canManageProfile(p);

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!manageable || isBusy}
                aria-label={`Manage ${p.email ?? p.full_name ?? "user"}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {p.access_status === "active" && (
                <DropdownMenuItem onClick={() => setPendingAction({ type: "deactivate", profile: p })}>
                  <Ban className="mr-2 h-4 w-4" />
                  Deactivate
                </DropdownMenuItem>
              )}
              {p.access_status === "blocked" && (
                <DropdownMenuItem onClick={() => setPendingAction({ type: "activate", profile: p })}>
                  <UserCheck className="mr-2 h-4 w-4" />
                  Reactivate
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-danger focus:text-danger"
                onClick={() => {
                  setDeleteConfirmText("");
                  setPendingAction({ type: "delete", profile: p });
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete permanently
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading workspace users…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Manage OXUS Cloud login roles and accounts. Deactivate live users to revoke access without deleting history.
        Delete test accounts permanently when they are no longer needed.
      </p>
      <DataTable tableId="team-workspace-access" data={profiles} columns={columns} />
      {superAdminCount <= 1 && (
        <p className="text-xs text-muted-foreground">
          Promote another user to super admin before demoting, deactivating, or deleting the last one.
        </p>
      )}

      <AlertDialog
        open={pendingAction?.type === "deactivate"}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === "deactivate" && (
                <>
                  <strong>{pendingAction.profile.email ?? pendingAction.profile.full_name}</strong> will be signed out and
                  cannot access OXUS Cloud until reactivated. Their data and audit history are preserved.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runPendingAction()} disabled={isBusy}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingAction?.type === "activate"}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === "activate" && (
                <>
                  Restore sign-in access for{" "}
                  <strong>{pendingAction.profile.email ?? pendingAction.profile.full_name}</strong>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runPendingAction()} disabled={isBusy}>
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingAction?.type === "delete"}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user permanently?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                {pendingAction?.type === "delete" && (
                  <>
                    <p>
                      This removes the login account and profile for{" "}
                      <strong className="text-foreground">
                        {pendingAction.profile.email ?? pendingAction.profile.full_name}
                      </strong>
                      . Use this for test accounts. This cannot be undone.
                    </p>
                    <p>
                      Type <strong className="text-foreground">{deleteConfirmationText(pendingAction.profile)}</strong> to
                      confirm.
                    </p>
                    <input
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={deleteConfirmationText(pendingAction.profile)}
                      aria-label="Delete confirmation"
                    />
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                isBusy ||
                pendingAction?.type !== "delete" ||
                deleteConfirmText.trim() !== deleteConfirmationText(pendingAction.profile)
              }
              onClick={(e) => {
                e.preventDefault();
                void runPendingAction();
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
