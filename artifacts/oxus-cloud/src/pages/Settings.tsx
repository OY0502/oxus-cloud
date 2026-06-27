import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
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
import { AlertCircle, Check, ShieldAlert, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDeleteOwnAccount, useProfiles, useUpdateProfile } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import {
  passwordRules,
  isPasswordValid,
  getPasswordStrength,
} from "@/lib/password";
import { cn } from "@/lib/utils";

export function Settings() {
  const { user, updatePassword, signOut } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const updateProfile = useUpdateProfile();
  const deleteAccount = useDeleteOwnAccount();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const myProfile = profiles.find((p) => p.id === user?.id);
  const [fullName, setFullName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");

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
