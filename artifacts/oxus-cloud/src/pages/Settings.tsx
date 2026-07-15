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
import { AlertCircle, Check, Link2, ShieldAlert, Slack, Unlink, X, CreditCard, RefreshCw, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useClickupMyConnection,
  useDeleteOwnAccount,
  useDisconnectClickup,
  useDisconnectSlack,
  useSlackWorkspaces,
  useStartClickupOAuth,
  useStartSlackOAuth,
  useUpdateProfile,
  useStripeConnectionStatus,
  useStripeSyncInvoices,
  useStripeWebhookRecovery,
  useGoogleCheckInterruptedImports,
  usePandaDocConnectionStatus,
  useGoogleConnectionStatus,
} from "@/hooks/api";
import { GoogleConnection } from "@/components/crm/GoogleConnection";
import { useClickupOAuthHandler } from "@/hooks/useClickupOAuthHandler";
import { useToast } from "@/hooks/use-toast";
import {
  passwordRules,
  isPasswordValid,
  getPasswordStrength,
} from "@/lib/password";
import { cn } from "@/lib/utils";

export function Settings() {
  const { user, updatePassword, signOut, isSuperAdmin } = useAuth();
  const updateProfile = useUpdateProfile();
  const deleteAccount = useDeleteOwnAccount();
  const { data: clickupStatus, refetch: refetchClickup } = useClickupMyConnection();
  const startClickupOAuth = useStartClickupOAuth();
  const disconnectClickup = useDisconnectClickup();
  const { data: slackWorkspaces = [], refetch: refetchSlack } = useSlackWorkspaces();
  const startSlackOAuth = useStartSlackOAuth();
  const disconnectSlack = useDisconnectSlack();
  const { data: stripeStatus, refetch: refetchStripe } = useStripeConnectionStatus({ enabled: isSuperAdmin });
  const syncStripe = useStripeSyncInvoices();
  const retryStripeWebhooks = useStripeWebhookRecovery();
  const checkInterruptedImports = useGoogleCheckInterruptedImports();
  const { data: pandadocStatus, refetch: refetchPandaDoc, isFetching: pandadocFetching } = usePandaDocConnectionStatus({
    enabled: isSuperAdmin,
  });
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
  const googleConnectedParam = clickupParams.get("google");
  const googleErrorMessage = clickupParams.get("message");

  const activeSlackWorkspace = slackWorkspaces.find((w) => w.status === "active") ?? null;

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

  const { refetch: refetchGoogle } = useGoogleConnectionStatus();

  useEffect(() => {
    if (googleConnectedParam === "connected") {
      setLocation("/settings/integrations", { replace: true });
      toast({ title: "Google connected", description: "OXUS is importing your relationship data in the background." });
      void refetchGoogle();
    }
    if (googleConnectedParam === "error" && googleErrorMessage) {
      toast({
        title: "Google connection failed",
        description: decodeURIComponent(googleErrorMessage),
        variant: "destructive",
      });
    }
  }, [googleConnectedParam, googleErrorMessage, refetchGoogle, setLocation, toast]);

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
      (user?.user_metadata?.full_name as string | undefined)?.trim() ||
      "";
    setFullName(name);
  }, [user]);

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

      <GoogleConnection variant="card" redirectAfter="/settings/integrations" enableGmail />

      {isSuperAdmin && (
        <Card id="google-import-diagnostics">
          <CardHeader>
            <CardTitle className="text-base">Google import watchdog</CardTitle>
            <CardDescription>
              Daily safety check for abandoned import runs. This does not fetch new Gmail or CRM data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={checkInterruptedImports.isPending}
              onClick={() => {
                checkInterruptedImports.mutate(undefined, {
                  onSuccess: () => toast({ title: "Watchdog queued", description: "Checking interrupted imports in the background." }),
                  onError: (e) => toast({ title: "Check failed", description: e.message, variant: "destructive" }),
                });
              }}
            >
              {checkInterruptedImports.isPending ? "Queueing…" : "Check interrupted imports"}
            </Button>
          </CardContent>
        </Card>
      )}

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
        <Card id="stripe-integration">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Stripe
            </CardTitle>
            <CardDescription>
              Server-side Stripe integration for invoicing and payment sync. Secrets are never exposed to the browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!stripeStatus?.configured ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Stripe is not configured. Set <code className="text-xs">STRIPE_SECRET_KEY</code> and{" "}
                  <code className="text-xs">STRIPE_WEBHOOK_SECRET</code> in Supabase Edge Function secrets.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-xs">Account</p>
                  <p className="font-medium">{stripeStatus.account?.business_name ?? stripeStatus.account?.email ?? "Connected"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Default currency</p>
                  <p>{stripeStatus.account?.default_currency?.toUpperCase() ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Last sync</p>
                  <p>{stripeStatus.last_successful_sync_at ? new Date(stripeStatus.last_successful_sync_at).toLocaleString() : "Never"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Webhook</p>
                  <p>{stripeStatus.webhook_configured ? "Signature configured" : "Secret missing"}</p>
                  <p className="text-xs text-muted-foreground">
                    Endpoint {stripeStatus.webhook_endpoint_reachable ? "reachable" : "unreachable"}
                  </p>
                  {stripeStatus.webhook_last_received_at && (
                    <p className="text-xs text-muted-foreground">
                      Last received: {new Date(stripeStatus.webhook_last_received_at).toLocaleString()}
                    </p>
                  )}
                  {stripeStatus.webhook_last_processed_at && (
                    <p className="text-xs text-muted-foreground">
                      Last processed: {new Date(stripeStatus.webhook_last_processed_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Webhook queue</p>
                  <p>Pending: {stripeStatus.webhook_pending_events ?? 0}</p>
                  <p>Failed: {stripeStatus.webhook_failed_events ?? 0}</p>
                  {stripeStatus.webhook_last_event_id && (
                    <p className="text-xs text-muted-foreground truncate">Last event: {stripeStatus.webhook_last_event_id}</p>
                  )}
                </div>
              </div>
            )}
            {stripeStatus?.last_sync_error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{stripeStatus.last_sync_error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={!stripeStatus?.configured || syncStripe.isPending}
                onClick={() => {
                  syncStripe.mutate(undefined, {
                    onSuccess: (r) => {
                      void refetchStripe();
                      toast({ title: "Sync complete", description: `${r.imported} imported, ${r.updated} updated.` });
                    },
                    onError: (e) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
                  });
                }}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncStripe.isPending ? "animate-spin" : ""}`} />
                Sync latest
              </Button>
              <Button
                variant="outline"
                disabled={!stripeStatus?.configured || retryStripeWebhooks.isPending || !(stripeStatus.webhook_failed_events ?? 0)}
                onClick={() => {
                  retryStripeWebhooks.mutate({ limit: 10 }, {
                    onSuccess: (r) => {
                      void refetchStripe();
                      toast({ title: "Webhook retry queued", description: `${r.retried} event(s) reprocessed.` });
                    },
                    onError: (e) => toast({ title: "Webhook retry failed", description: e.message, variant: "destructive" }),
                  });
                }}
              >
                Retry failed webhooks
              </Button>
              <Button variant="ghost" onClick={() => void refetchStripe()}>Refresh status</Button>
            </div>
            <p className="text-xs text-muted-foreground">Sync latest pulls invoice changes from Stripe. Webhook retries reprocess failed inbox events only.</p>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && (
        <Card id="pandadoc-integration">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              PandaDoc
            </CardTitle>
            <CardDescription>
              Server-side PandaDoc workspace integration for linking MSA, NDA, SOW, and other documents to projects.
              API keys never reach the browser. Document content is not ingested into Project Intelligence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!pandadocStatus?.configured ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  PandaDoc is not configured. Set <code className="text-xs">PANDADOC_API_KEY</code> and optionally{" "}
                  <code className="text-xs">PANDADOC_WEBHOOK_SHARED_KEY</code> in Supabase Edge Function secrets.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <p className="font-medium">{pandadocStatus.connected ? "Configured / Connected" : "Configured"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Workspace</p>
                  <p>{pandadocStatus.workspace_name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Last successful sync</p>
                  <p>
                    {pandadocStatus.last_successful_sync_at
                      ? new Date(pandadocStatus.last_successful_sync_at).toLocaleString()
                      : "Never"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Webhook</p>
                  <p>{pandadocStatus.webhook_configured ? "Configured" : "Shared key missing"}</p>
                  {pandadocStatus.webhook_last_received_at && (
                    <p className="text-xs text-muted-foreground">
                      Last event: {new Date(pandadocStatus.webhook_last_received_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}
            {pandadocStatus?.last_sync_error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{pandadocStatus.last_sync_error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!pandadocStatus?.configured || pandadocFetching}
                onClick={() => {
                  void refetchPandaDoc().then(() => {
                    toast({ title: "Connection tested", description: "PandaDoc status refreshed." });
                  });
                }}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${pandadocFetching ? "animate-spin" : ""}`} />
                Test connection
              </Button>
              <Button variant="ghost" onClick={() => void refetchPandaDoc()}>Refresh status</Button>
            </div>
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
