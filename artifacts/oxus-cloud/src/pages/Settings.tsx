import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertCircle, Check, Link2, ShieldAlert, Slack, Unlink, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useClickupMyConnection,
  useDeleteOwnAccount,
  useDisconnectClickup,
  useDisconnectSlack,
  useProfiles,
  useSetProfileRole,
  useSlackWorkspaces,
  useStartClickupOAuth,
  useStartSlackOAuth,
  useUpdateProfile,
} from "@/hooks/api";
import { useClickupOAuthHandler } from "@/hooks/useClickupOAuthHandler";
import { normalizeProfileRole, roleLabel } from "@/lib/roles";
import type { ProfileRole } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  passwordRules,
  isPasswordValid,
  getPasswordStrength,
} from "@/lib/password";
import { cn } from "@/lib/utils";

export function Settings() {
  const { user, updatePassword, signOut, isSuperAdmin, refreshProfile } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const updateProfile = useUpdateProfile();
  const setProfileRole = useSetProfileRole();
  const deleteAccount = useDeleteOwnAccount();
  const { data: clickupStatus, refetch: refetchClickup } = useClickupMyConnection();
  const startClickupOAuth = useStartClickupOAuth();
  const disconnectClickup = useDisconnectClickup();
  const { data: slackWorkspaces = [], refetch: refetchSlack } = useSlackWorkspaces();
  const startSlackOAuth = useStartSlackOAuth();
  const disconnectSlack = useDisconnectSlack();
  const { startConnect } = useClickupOAuthHandler();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();

  const clickupParams = useMemo(() => new URLSearchParams(search), [search]);
  const highlightClickup = clickupParams.get("connect") === "clickup";
  const clickupConnectedParam = clickupParams.get("clickup");
  const clickupErrorMessage = clickupParams.get("message");
  const highlightSlack = clickupParams.get("connect") === "slack";
  const slackConnectedParam = clickupParams.get("slack");
  const slackErrorMessage = clickupParams.get("message");

  const activeSlackWorkspace = slackWorkspaces.find((w) => w.status === "active") ?? null;

  const myProfile = profiles.find((p) => p.id === user?.id);
  const [fullName, setFullName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    if (clickupConnectedParam === "connected") {
      void refetchClickup();
      toast({ title: "ClickUp connected", description: "OXUS can now post updates as your ClickUp account." });
      setLocation("/settings");
    }
    if (clickupConnectedParam === "error" && clickupErrorMessage) {
      toast({
        title: "ClickUp connection failed",
        description: decodeURIComponent(clickupErrorMessage),
        variant: "destructive",
      });
      setLocation("/settings");
    }
  }, [clickupConnectedParam, clickupErrorMessage, refetchClickup, setLocation, toast]);

  useEffect(() => {
    if (slackConnectedParam === "connected") {
      void refetchSlack();
      toast({ title: "Slack connected", description: "OXUS can now analyze linked project channels." });
      setLocation("/settings");
    }
    if (slackConnectedParam === "error" && slackErrorMessage) {
      toast({
        title: "Slack connection failed",
        description: decodeURIComponent(slackErrorMessage),
        variant: "destructive",
      });
      setLocation("/settings");
    }
  }, [slackConnectedParam, slackErrorMessage, refetchSlack, setLocation, toast]);

  const connectClickup = async () => {
    try {
      await startConnect(() => startClickupOAuth.mutateAsync({ redirect_after: "/settings" }));
    } catch (err) {
      toast({
        title: "Could not start ClickUp connection",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

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

  const superAdminCount = profiles.filter((p) => normalizeProfileRole(p.role) === "super_admin").length;

  const handleDisconnectClickup = async () => {
    try {
      await disconnectClickup.mutateAsync();
      toast({ title: "ClickUp disconnected", description: "Your ClickUp account is no longer linked to OXUS." });
    } catch (err) {
      toast({
        title: "Could not disconnect ClickUp",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const connectSlack = async () => {
    try {
      await startConnect(() => startSlackOAuth.mutateAsync({ redirect_after: "/settings" }));
    } catch (err) {
      toast({
        title: "Could not start Slack connection",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDisconnectSlack = async () => {
    try {
      await disconnectSlack.mutateAsync();
      toast({ title: "Slack disconnected", description: "The workspace is no longer linked to OXUS." });
    } catch (err) {
      toast({
        title: "Could not disconnect Slack",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const clickupConnection = clickupStatus?.connection ?? null;
  const clickupConnected = clickupStatus?.connected === true;

  useEffect(() => {
    const name =
      myProfile?.full_name?.trim() ||
      (user?.user_metadata?.full_name as string | undefined)?.trim() ||
      "";
    setFullName(name);
  }, [myProfile, user]);

  const strength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);
  const passwordValid = isPasswordValid(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !fullName.trim()) return;
    setProfileSaving(true);
    try {
      await updateProfile.mutateAsync({ id: user.id, full_name: fullName.trim() });
      toast({ title: "Profile updated", description: "Your name has been saved." });
    } catch (err) {
      toast({
        title: "Couldn't save profile",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (!passwordValid) {
      setPasswordError("Please choose a password that meets all requirements.");
      return;
    }
    if (!passwordsMatch) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      await updatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password changed", description: "Use your new password next time you sign in." });
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Unable to change password. Please try again.",
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount.mutateAsync();
      await signOut();
      setLocation("/login");
      toast({ title: "Account deleted", description: "Your account has been permanently removed." });
    } catch (err) {
      toast({
        title: "Couldn't delete account",
        description: err instanceof Error ? err.message : "Please try again or contact support.",
        variant: "destructive",
      });
    }
  };

  const strengthBarColor =
    strength.label === "strong"
      ? "bg-green-500"
      : strength.label === "good"
        ? "bg-emerald-500"
        : strength.label === "fair"
          ? "bg-amber-500"
          : "bg-destructive";

  const email = user?.email ?? "";

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Settings"
        subtitle="Manage your account and security preferences."
      />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update how your name appears across the workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Display name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
            <Button type="submit" disabled={profileSaving || !fullName.trim()}>
              {profileSaving ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Choose a strong password to protect your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {passwordError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{passwordError}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              {newPassword.length > 0 && (
                <div className="pt-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full transition-all", strengthBarColor)}
                        style={{ width: `${strength.score}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground capitalize w-12 text-right">
                      {strength.label}
                    </span>
                  </div>
                  <ul className="grid grid-cols-1 gap-1">
                    {passwordRules.map((rule) => {
                      const ok = rule.test(newPassword);
                      return (
                        <li
                          key={rule.id}
                          className={cn(
                            "flex items-center gap-2 text-xs",
                            ok ? "text-green-600" : "text-muted-foreground",
                          )}
                        >
                          {ok ? <Check className="w-3.5 h-3.5 shrink-0" /> : <X className="w-3.5 h-3.5 shrink-0" />}
                          {rule.label}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-destructive">Passwords do not match.</p>
              )}
            </div>
            <Button
              type="submit"
              disabled={passwordSaving || !passwordValid || !passwordsMatch}
            >
              {passwordSaving ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className={highlightClickup ? "ring-2 ring-primary" : undefined} id="clickup-account">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            ClickUp account
          </CardTitle>
          <CardDescription>
            Connect ClickUp so OXUS can create tasks, post comments, and update statuses as you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(clickupConnection?.last_error || clickupConnectedParam === "error") && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {clickupConnection?.last_error ?? (clickupErrorMessage ? decodeURIComponent(clickupErrorMessage) : "ClickUp connection error.")}
              </AlertDescription>
            </Alert>
          )}

          {clickupConnected && clickupConnection ? (
            <div className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-xs">ClickUp user</p>
                  <p className="font-medium">
                    {clickupConnection.clickup_username ?? clickupConnection.clickup_email ?? "Connected user"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Workspace</p>
                  <p className="font-medium">{clickupConnection.selected_team_name ?? clickupConnection.selected_team_id ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Connected</p>
                  <p>{new Date(clickupConnection.connected_at).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Last verified</p>
                  <p>{clickupConnection.last_verified_at ? new Date(clickupConnection.last_verified_at).toLocaleString() : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <p className="capitalize">{clickupConnection.status}</p>
                </div>
              </div>
              {clickupConnection.authorized_teams?.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Authorized workspaces: {clickupConnection.authorized_teams.map((team) => team.name).join(", ")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={connectClickup} disabled={startClickupOAuth.isPending}>
                  {startClickupOAuth.isPending ? "Redirecting…" : "Reconnect ClickUp"}
                </Button>
                <Button variant="ghost" className="gap-1" onClick={handleDisconnectClickup} disabled={disconnectClickup.isPending}>
                  <Unlink className="h-4 w-4" /> Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You are not connected to ClickUp. User-triggered actions like creating tasks, posting comments, and syncing updates require your personal ClickUp authorization.
              </p>
              <Button onClick={connectClickup} disabled={startClickupOAuth.isPending}>
                {startClickupOAuth.isPending ? "Redirecting…" : "Connect ClickUp"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={highlightSlack ? "ring-2 ring-primary" : undefined} id="slack-workspace">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Slack className="h-5 w-5" />
            Slack workspace
          </CardTitle>
          <CardDescription>
            Connect Slack so OXUS can analyze project channels for blockers, questions, decisions, and progress.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(activeSlackWorkspace?.last_error || slackConnectedParam === "error") && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {activeSlackWorkspace?.last_error ??
                  (slackErrorMessage ? decodeURIComponent(slackErrorMessage) : "Slack connection error.")}
              </AlertDescription>
            </Alert>
          )}

          {activeSlackWorkspace ? (
            <div className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-xs">Workspace</p>
                  <p className="font-medium">{activeSlackWorkspace.slack_team_name ?? activeSlackWorkspace.slack_team_id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Team ID</p>
                  <p className="font-mono text-xs">{activeSlackWorkspace.slack_team_id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Connected</p>
                  <p>{new Date(activeSlackWorkspace.connected_at).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <p className="capitalize">{activeSlackWorkspace.status}</p>
                </div>
              </div>
              {isSuperAdmin ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={connectSlack} disabled={startSlackOAuth.isPending}>
                    {startSlackOAuth.isPending ? "Redirecting…" : "Reconnect Slack"}
                  </Button>
                  <Button variant="ghost" className="gap-1" onClick={handleDisconnectSlack} disabled={disconnectSlack.isPending}>
                    <Unlink className="h-4 w-4" /> Disconnect
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Workspace is connected. Link channels per project from Project Detail. Only super admins can reconnect or disconnect.
                </p>
              )}
            </div>
          ) : isSuperAdmin ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your Slack workspace once, then link specific channels to each project.
              </p>
              <Button onClick={connectSlack} disabled={startSlackOAuth.isPending}>
                {startSlackOAuth.isPending ? "Redirecting…" : "Connect Slack"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Slack is not connected yet. Ask a super admin to connect the workspace from Settings.
            </p>
          )}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>User roles</CardTitle>
            <CardDescription>
              Manage workspace access. Role changes are applied securely on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => {
              const role = normalizeProfileRole(profile.role);
              const isSelf = profile.id === user?.id;
              const isLastSuperAdmin = role === "super_admin" && superAdminCount <= 1;
              return (
                <div
                  key={profile.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{profile.full_name ?? profile.email ?? "User"}</p>
                    <p className="text-xs text-muted-foreground truncate">{profile.email ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Joined {new Date(profile.created_at).toLocaleDateString()}
                      {isSelf ? " · you" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={role}
                      disabled={setProfileRole.isPending || isLastSuperAdmin}
                      onValueChange={(value) => void handleRoleChange(profile.id, value as ProfileRole)}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pm">PM</SelectItem>
                        <SelectItem value="super_admin">Super admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
            {superAdminCount <= 1 && (
              <p className="text-xs text-muted-foreground">
                The last super admin cannot be demoted. Promote another user first.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Danger zone
          </CardTitle>
          <CardDescription>
            Permanently delete your account and remove your access to this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete my account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. Your profile and login will be permanently removed.
                  Type <strong>DELETE</strong> below to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="mt-2"
              />
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeleteConfirm("")}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteConfirm !== "DELETE" || deleteAccount.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleDeleteAccount();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteAccount.isPending ? "Deleting…" : "Delete account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
