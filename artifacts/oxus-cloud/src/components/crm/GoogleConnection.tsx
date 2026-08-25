import React, { useCallback, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  CalendarRange,
  CheckCircle2,
  Contact,
  History,
  KeyRound,
  Loader2,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Settings2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { useToast } from "@/hooks/use-toast";
import {
  useDisconnectGoogle,
  useGoogleWorkspaceSync,
  useStartGoogleOAuth,
} from "@/hooks/api";
import {
  formatSyncProgressDetail,
  formatSyncSummaryText,
  GOOGLE_SYNC_STAGE_LABELS,
} from "@/lib/googleSync";
import { cn } from "@/lib/utils";

type GoogleConnectionProps = {
  variant?: "card" | "compact" | "banner" | "strip";
  redirectAfter?: string;
  showManageLink?: boolean;
  enableGmail?: boolean;
  hideManualSync?: boolean;
  onImportCenter?: () => void;
};

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function GoogleConnection({
  variant = "card",
  redirectAfter = "/crm",
  showManageLink = false,
  enableGmail = false,
  hideManualSync = false,
  onImportCenter,
}: GoogleConnectionProps) {
  const { toast } = useToast();
  const {
    connected,
    connection,
    syncStatus,
    canonicalStatus,
    recentCompletion,
    isSyncing,
    isEnrichmentActive,
    triggerSync,
    dismissCompletion,
    connectionQuery,
    activeImport,
    syncNow,
  } = useGoogleWorkspaceSync();
  const startOAuth = useStartGoogleOAuth();
  const disconnect = useDisconnectGoogle();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [historyNoteDismissed, setHistoryNoteDismissed] = useState(false);
  const isLoading = connectionQuery.isLoading;

  const enableGmailAuth = useCallback(async () => {
    try {
      const { auth_url } = await startOAuth.mutateAsync({
        redirect_after: redirectAfter,
        incremental_gmail: true,
      });
      window.location.href = auth_url;
    } catch (e) {
      toast({
        title: "Could not enable Gmail",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }, [redirectAfter, startOAuth, toast]);

  const sources = (connection?.sources_enabled ?? {}) as Record<string, boolean>;
  const gmailScopeGranted = (connection?.granted_scopes ?? []).includes(
    "https://www.googleapis.com/auth/gmail.readonly",
  );
  const contactsOn = sources.contacts !== false;
  const calendarOn = sources.calendar !== false;
  const gmailOn = gmailScopeGranted && !!sources.gmail;

  const connect = useCallback(async () => {
    try {
      const { auth_url } = await startOAuth.mutateAsync({ redirect_after: redirectAfter, enable_gmail: enableGmail });
      window.location.href = auth_url;
    } catch (e) {
      toast({
        title: "Could not start Google connection",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }, [enableGmail, redirectAfter, startOAuth, toast]);

  const handleSync = async (retry = false) => {
    if (isSyncing) return;
    try {
      const result = await syncNow.mutateAsync({ retry });
      if (result?.already_running) {
        toast({ title: "Sync already running", description: "Showing current progress." });
      } else if (retry) {
        toast({ title: "Resuming import", description: "Continuing from the last saved checkpoint." });
      } else {
        toast({ title: "Sync started", description: "Google data is syncing in the background." });
      }
    } catch (e) {
      toast({
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync({ confirm: true });
      toast({ title: "Google disconnected", description: "Sync has stopped. Your CRM records are preserved." });
      void connectionQuery.refetch();
    } catch (e) {
      toast({
        title: "Disconnect failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDisconnectOpen(false);
    }
  };

  const runCounts = (activeImport?.counts ?? connectionQuery.data?.latest_import?.counts) as Record<string, unknown> | undefined;
  const stageLabel = canonicalStatus.title;
  const enrichmentDetail = canonicalStatus.phase === "enrichment"
    ? formatSyncProgressDetail({ ...syncStatus, stage: "analyzing_relationships" }, runCounts)
    : null;
  const progressDetail = canonicalStatus.subtitle ?? formatSyncProgressDetail(syncStatus, runCounts);
  const showRetry = canonicalStatus.show_retry;
  const showError = canonicalStatus.banner_severity === "error";
  const showWarning = canonicalStatus.banner_severity === "warning";
  const showProgress = canonicalStatus.banner_severity === "info" && canonicalStatus.active;
  const showSuccess = recentCompletion && (recentCompletion.stage === "completed" || recentCompletion.stage === "completed_with_warnings");
  const showHistoricalNote = Boolean(canonicalStatus.recovered && canonicalStatus.historical_interruption && !historyNoteDismissed);

  if (variant === "banner" && !connected && !isLoading) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-lg">Build your CRM automatically</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Connect Google Contacts and Calendar to discover companies, people, and relationship activity.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Gmail relationship analysis can be enabled separately.
            </p>
          </div>
          <Button onClick={connect} disabled={startOAuth.isPending}>
            {startOAuth.isPending ? "Redirecting…" : "Connect Google"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (variant === "compact" && !connected && !isLoading) {
    return (
      <Button onClick={connect} disabled={startOAuth.isPending} variant="outline">
        {startOAuth.isPending ? "Redirecting…" : "Connect Google"}
      </Button>
    );
  }

  if (variant === "compact" && connected && !hideManualSync) {
    return (
      <Button variant="outline" size="sm" onClick={() => void handleSync(false)} disabled={isSyncing} aria-busy={isSyncing}>
        {isSyncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
        {isSyncing ? "Syncing…" : "Sync latest"}
      </Button>
    );
  }

  if (variant === "strip" && connected && connection) {
    return (
      <div
        className={cn(
          "rounded-lg border bg-card px-3 py-2.5 sm:px-4",
          showError && "border-destructive/40 bg-destructive/5",
          showWarning && "border-amber-500/40 bg-amber-500/5",
          showProgress && "border-sky-500/30 bg-sky-500/5",
          showSuccess && "border-emerald-500/30 bg-emerald-500/5",
        )}
        role="region"
        aria-label="Google Workspace connection"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <GoogleIcon className="h-5 w-5 shrink-0 mt-0.5 sm:mt-0" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">Google Workspace</span>
                <span className="text-sm text-muted-foreground truncate">{connection.google_email}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[11px] font-normal px-1.5 py-0 h-5">
                  <Contact className="w-3 h-3 mr-1" />{contactsOn ? "Contacts connected" : "Contacts off"}
                </Badge>
                <Badge variant="outline" className="text-[11px] font-normal px-1.5 py-0 h-5">
                  <Calendar className="w-3 h-3 mr-1" />{calendarOn ? "Calendar connected" : "Calendar off"}
                </Badge>
                {!gmailScopeGranted && (
                  <Badge variant="outline" className="text-[11px] font-normal px-1.5 py-0 h-5 text-muted-foreground">
                    <Mail className="w-3 h-3 mr-1" />Gmail not enabled
                  </Badge>
                )}
                {gmailScopeGranted && gmailOn && (
                  <Badge variant="outline" className="text-[11px] font-normal px-1.5 py-0 h-5">
                    <Mail className="w-3 h-3 mr-1" />Gmail connected
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 lg:max-w-md" aria-live="polite" aria-atomic="true">
            {showSuccess && recentCompletion.summary ? (
              <div className="text-sm">
                <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" /> Google sync completed
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{formatSyncSummaryText(recentCompletion.summary, runCounts)}</p>
                {recentCompletion.summary.candidates_created > 0 && onImportCenter && (
                  <button type="button" className="text-xs text-primary hover:underline mt-1" onClick={onImportCenter}>
                    Review {recentCompletion.summary.candidates_created} records
                  </button>
                )}
              </div>
            ) : showError ? (
              <div className="text-sm">
                <div className="flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="w-4 h-4" /> {canonicalStatus.title}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{canonicalStatus.subtitle ?? syncStatus.error?.message}</p>
                {(canonicalStatus.history.length > 0 || canonicalStatus.historical_interruption) && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline mt-1"
                    onClick={() => setErrorDetailsOpen((v) => !v)}
                  >
                    {errorDetailsOpen ? "Hide details" : "View details"}
                  </button>
                )}
                {errorDetailsOpen && (
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    {canonicalStatus.historical_interruption && (
                      <p>{canonicalStatus.historical_interruption.message}</p>
                    )}
                    {canonicalStatus.history.slice(-4).map((entry) => (
                      <p key={`${entry.at}-${entry.event}`}>
                        {new Date(entry.at).toLocaleString(undefined, { month: "short", day: "numeric" })}
                        {" · "}
                        {entry.detail ?? entry.event}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : showWarning ? (
              <div className="text-sm">
                <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4" /> {canonicalStatus.title}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{canonicalStatus.subtitle}</p>
              </div>
            ) : isSyncing || showProgress ? (
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-sky-900 dark:text-sky-100">{stageLabel}</div>
                {progressDetail && <p className="text-xs text-muted-foreground">{progressDetail}</p>}
                {showHistoricalNote && (
                  <p className="text-[11px] text-muted-foreground">
                    The historical import previously paused and resumed automatically.{" "}
                    <button type="button" className="underline" onClick={() => setHistoryNoteDismissed(true)}>Dismiss</button>
                  </p>
                )}
                <Progress
                  value={syncStatus.progress_percentage ?? (isSyncing || showProgress ? undefined : 0)}
                  className={cn("h-1.5", (isSyncing || showProgress) && syncStatus.progress_percentage == null && "[&>div]:animate-pulse [&>div]:w-full")}
                  aria-label={stageLabel}
                  aria-valuetext={progressDetail ?? stageLabel}
                />
              </div>
            ) : syncStatus.coreComplete && isEnrichmentActive ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">{GOOGLE_SYNC_STAGE_LABELS.core_sync_complete}</div>
                {runCounts && (
                  <p className="text-xs text-muted-foreground">{formatSyncSummaryText(syncStatus.summary ?? { companies_created: 0, companies_updated: 0, people_created: 0, people_updated: 0, candidates_created: 0, warnings: 0 }, runCounts)}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {GOOGLE_SYNC_STAGE_LABELS.analyzing_relationships}
                  {enrichmentDetail ? ` · ${enrichmentDetail}` : ""}
                </p>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Last synced{" "}
                {connection.last_successful_sync_at
                  ? formatDistanceToNow(new Date(connection.last_successful_sync_at), { addSuffix: true })
                  : "never"}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {showError || showWarning ? (
              <>
                {showRetry && (
                  <Button size="sm" variant="outline" onClick={() => void handleSync(true)} disabled={isSyncing || canonicalStatus.active}>
                    Retry
                  </Button>
                )}
                {onImportCenter && (
                  <Button size="sm" variant="ghost" onClick={onImportCenter}>View details</Button>
                )}
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void handleSync(false)} disabled={isSyncing || hideManualSync} aria-busy={isSyncing} className={hideManualSync ? "hidden" : undefined}>
                {isSyncing ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Syncing…</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Sync latest</>
                )}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="Manage Google connection">
                  <MoreHorizontal className="w-4 h-4 mr-1" />Manage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <a href="/settings/integrations#google-integration" className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4 shrink-0" />
                    Connection settings
                  </a>
                </DropdownMenuItem>
                {onImportCenter && (
                  <DropdownMenuItem onSelect={onImportCenter}>
                    <History className="w-4 h-4 shrink-0" />
                    Import history
                  </DropdownMenuItem>
                )}
                {!gmailScopeGranted && (
                  <DropdownMenuItem onSelect={enableGmailAuth}>
                    <Mail className="w-4 h-4 shrink-0" />
                    Enable Gmail relationship analysis
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <a href="/settings/integrations#google-integration" className="flex items-center gap-2">
                    <CalendarRange className="w-4 h-4 shrink-0" />
                    Change import range
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/settings/integrations#google-integration" className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 shrink-0" />
                    Reconnect permissions
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDisconnectOpen(true)}>
                  <Unlink className="w-4 h-4 shrink-0" />
                  Disconnect Google
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {isSyncing && onImportCenter && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline" onClick={onImportCenter}>
                Import center
              </button>
            )}
            {showProgress && onImportCenter && !isSyncing && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline" onClick={onImportCenter}>
                Import center
              </button>
            )}
          </div>
        </div>

        {showSuccess && (
          <button type="button" className="sr-only" onClick={dismissCompletion}>Dismiss sync completion</button>
        )}

        <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Google Workspace?</AlertDialogTitle>
              <AlertDialogDescription>
                Sync will stop immediately. Existing CRM records and import history are preserved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDisconnect} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (variant === "strip" && !connected && !isLoading) {
    return null;
  }

  return (
    <Card id="google-integration">
      <CardContent className="pt-6 space-y-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5" />Google Workspace
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Import Contacts, Calendar meetings, and optional Gmail relationship signals into OXUS CRM.
          </p>
        </div>

        {connected && connection ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">Google account</p>
                <p className="font-medium">{connection.google_email}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Last sync</p>
                <p>
                  {connection.last_successful_sync_at
                    ? formatDistanceToNow(new Date(connection.last_successful_sync_at), { addSuffix: true })
                    : "—"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {contactsOn && <Badge variant="secondary"><Contact className="w-3 h-3 mr-1" /> Contacts</Badge>}
              {calendarOn && <Badge variant="secondary"><Calendar className="w-3 h-3 mr-1" /> Calendar</Badge>}
              {gmailOn && <Badge variant="secondary"><Mail className="w-3 h-3 mr-1" /> Gmail</Badge>}
            </div>

            {isSyncing && (
              <div className="space-y-1" aria-live="polite">
                <p className="text-sm font-medium">{stageLabel}</p>
                {progressDetail && <p className="text-xs text-muted-foreground">{progressDetail}</p>}
                <Progress value={syncStatus.progress_percentage ?? undefined} aria-label={stageLabel} />
              </div>
            )}

            {showError && (
              <p className="text-sm text-destructive">{syncStatus.error?.message}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void handleSync(false)} disabled={isSyncing} aria-busy={isSyncing}>
                {isSyncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {isSyncing ? "Syncing…" : "Sync latest"}
              </Button>
              {showManageLink && (
                <Button variant="ghost" asChild>
                  <a href="/settings/integrations#google-integration"><Settings2 className="w-4 h-4 mr-2" />Manage</a>
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDisconnectOpen(true)} disabled={disconnect.isPending}>
                <Unlink className="w-4 h-4 mr-2" /> Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
              <li><strong>Contacts</strong> — import saved people and contact details</li>
              <li><strong>Calendar</strong> — import meeting participants and relationship activity</li>
              <li><strong>Gmail</strong> — optional analysis of relationship signals (read-only)</li>
            </ul>
            <Button onClick={connect} disabled={startOAuth.isPending}>
              {startOAuth.isPending ? "Redirecting…" : "Connect Google"}
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Sync will stop. Your CRM records are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
