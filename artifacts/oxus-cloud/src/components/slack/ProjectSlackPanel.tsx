import React, { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Hash, Link2, Lock, RefreshCw, Slack } from "lucide-react";
import { SearchableSelect } from "@/components/forms/SearchableSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useProjectSlackLinks,
  useProjectSlackPipelineDiagnostics,
  useReprocessSlackEvents,
  useBackfillProjectTimeline,
  useSlackLinkProjectChannel,
  useSlackListChannels,
  useSlackSyncProjectChannel,
  useSlackWorkspaces,
  useUpdateProjectSlackLink,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import type {
  ProjectSlackLink,
  ProjectSlackLinkType,
  ReprocessSlackEventsResult,
  SlackSyncProjectChannelResult,
} from "@/lib/types";

type SlackChannelOption = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  is_ext_shared: boolean;
  suggested_link_type: "internal" | "external";
};

function linkTypeLabel(type: ProjectSlackLinkType) {
  if (type === "external") return "External";
  if (type === "other") return "Other";
  return "Internal";
}

function signalLabel(signal: string | null | undefined) {
  return (signal ?? "unknown").replace(/_/g, " ");
}

function channelOptionLabel(channel: SlackChannelOption) {
  const shared = channel.is_ext_shared ? " (shared)" : "";
  if (channel.is_private) return `${channel.name}${shared} (private)`;
  return `#${channel.name}${shared}`;
}

function SlackLinkDiagnostics({
  projectId,
  link,
  syncResult,
  reprocessResult,
  onReprocess,
  reprocessBusy,
}: {
  projectId: string;
  link: ProjectSlackLink;
  syncResult?: SlackSyncProjectChannelResult | null;
  reprocessResult?: ReprocessSlackEventsResult | null;
  onReprocess?: () => void;
  reprocessBusy?: boolean;
}) {
  const { data, isLoading, isError, error } = useProjectSlackPipelineDiagnostics(projectId, link);
  const backfillTimeline = useBackfillProjectTimeline();
  const showReprocessButton =
    (data?.slackEventsCount ?? 0) > 0 && (data?.projectSignalsCount ?? 0) === 0;

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="diagnostics" className="border-none">
        <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
          Diagnostics
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pt-1 text-xs">
          <div className="grid gap-1 text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">project_slack_link_id:</span> {link.id}
            </p>
            <p>
              <span className="font-medium text-foreground">channel id:</span> {link.slack_channel_id}
            </p>
            <p>
              <span className="font-medium text-foreground">channel name:</span>{" "}
              {link.channel_name ?? "—"}
            </p>
            <p>
              <span className="font-medium text-foreground">include_in_ai:</span>{" "}
              {link.include_in_ai ? "yes" : "no"}
            </p>
            <p>
              <span className="font-medium text-foreground">include_in_client_updates:</span>{" "}
              {link.include_in_client_updates ? "yes" : "no"}
            </p>
            <p>
              <span className="font-medium text-foreground">last_synced_at:</span>{" "}
              {link.last_synced_at ? new Date(link.last_synced_at).toLocaleString() : "—"}
            </p>
            <p>
              <span className="font-medium text-foreground">last_event_ts:</span> {link.last_event_ts ?? "—"}
            </p>
            <p>
              <span className="font-medium text-foreground">last_error:</span> {link.last_error ?? "—"}
            </p>
          </div>

          {isLoading ? (
            <p className="text-muted-foreground">Loading pipeline counts…</p>
          ) : isError ? (
            <p className="text-destructive">{(error as Error).message}</p>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Slack events stored", data.slackEventsCount],
                  ["Meaningful Slack events", data.meaningfulSlackEventsCount],
                  ["project_signals (Slack)", data.projectSignalsCount],
                  ["Open Slack threads", data.openSignalThreadsCount],
                  ["Queued/running AI jobs", data.queuedOrRunningJobsCount],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded border border-border/60 bg-muted/10 p-2">
                    <p className="section-label text-[10px]">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <p>
                  <span className="font-medium text-foreground">Latest AI job:</span>{" "}
                  {data.latestJob
                    ? `${data.latestJob.status} (${formatDistanceToNow(new Date(data.latestJob.created_at), { addSuffix: true })})`
                    : "—"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Latest Slack PM action:</span>{" "}
                  {data.latestSlackPmAction?.title ?? "—"}
                </p>
              </div>
              {data.hints?.length > 0 && (
                <div className="space-y-1 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-900 dark:text-amber-200">
                  {data.hints.map((hint) => (
                    <p key={hint}>{hint}</p>
                  ))}
                </div>
              )}
              {showReprocessButton && onReprocess && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={reprocessBusy}
                  onClick={onReprocess}
                >
                  Reprocess Slack events
                </Button>
              )}
            </>
          ) : null}

          {reprocessResult && (
            <div className="space-y-2 rounded border border-border/60 bg-muted/10 p-2">
              <p className="font-medium text-foreground">Last reprocess result</p>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                <p>events checked: {reprocessResult.events_checked}</p>
                <p>signals upserted: {reprocessResult.signals_upserted}</p>
                <p>meaningful: {reprocessResult.meaningful_signals}</p>
                <p>noise: {reprocessResult.noise_signals}</p>
                <p>threads upserted: {reprocessResult.threads_upserted}</p>
                <p>jobs queued: {reprocessResult.jobs_queued}</p>
                {(reprocessResult.actions_created ?? 0) > 0 && (
                  <p>actions created: {reprocessResult.actions_created}</p>
                )}
                {(reprocessResult.actions_updated ?? 0) > 0 && (
                  <p>actions updated: {reprocessResult.actions_updated}</p>
                )}
                {(reprocessResult.actions_auto_resolved ?? 0) > 0 && (
                  <p>auto-resolved: {reprocessResult.actions_auto_resolved}</p>
                )}
                {(reprocessResult.timeline_events_created ?? 0) > 0 && (
                  <p>timeline created: {reprocessResult.timeline_events_created}</p>
                )}
                {(reprocessResult.duplicates_avoided ?? 0) > 0 && (
                  <p>duplicates avoided: {reprocessResult.duplicates_avoided}</p>
                )}
              </div>
              {(reprocessResult.previews ?? []).length > 0 && (
                <p className="text-muted-foreground">
                  {reprocessResult.previews.length} signal preview(s) in diagnostics — open sync details in server logs.
                </p>
              )}
            </div>
          )}

          {syncResult && (
            <div className="space-y-2 rounded border border-border/60 bg-muted/10 p-2">
              <p className="font-medium text-foreground">Last sync result</p>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                <p>imported: {syncResult.imported_count}</p>
                <p>thread replies: {syncResult.thread_replies_imported_count}</p>
                <p>skipped: {syncResult.skipped_count}</p>
                <p>events upserted: {syncResult.events_upserted_count}</p>
                <p>signals upserted: {syncResult.signals_upserted_count}</p>
                <p>meaningful signals: {syncResult.meaningful_signals_count}</p>
                <p>threads upserted: {syncResult.signal_threads_upserted_count}</p>
                <p>jobs queued: {syncResult.jobs_queued_count}</p>
              </div>
              {(syncResult.warnings ?? []).length > 0 && (
                <div className="text-amber-700 dark:text-amber-300">
                  {(syncResult.warnings ?? []).map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          {onReprocess && !showReprocessButton && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={reprocessBusy}
              onClick={onReprocess}
            >
              Reprocess Slack events
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={backfillTimeline.isPending}
            onClick={() => backfillTimeline.mutate({ project_id: projectId })}
          >
            Backfill timeline
          </Button>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function LinkCard({
  link,
  projectId,
  busy,
  onSync,
  onDisable,
  onReprocess,
  syncResult,
  reprocessResult,
  reprocessBusy,
}: {
  link: ProjectSlackLink;
  projectId: string;
  busy: boolean;
  onSync: () => void;
  onDisable: () => void;
  onReprocess: () => void;
  syncResult?: SlackSyncProjectChannelResult | null;
  reprocessResult?: ReprocessSlackEventsResult | null;
  reprocessBusy?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-sm font-medium">{link.channel_name ?? link.slack_channel_id}</p>
            <Badge variant="outline" className="text-[10px] h-5">
              {linkTypeLabel(link.link_type)}
            </Badge>
            {link.is_private && (
              <Badge variant="secondary" className="text-[10px] h-5 gap-0.5">
                <Lock className="h-2.5 w-2.5" />
                Private
              </Badge>
            )}
            {link.is_ext_shared && (
              <Badge variant="secondary" className="text-[10px] h-5">
                Slack Connect
              </Badge>
            )}
            {link.status !== "active" && (
              <Badge variant="destructive" className="text-[10px] h-5 capitalize">
                {link.status}
              </Badge>
            )}
          </div>
          {link.link_label && <p className="text-xs text-muted-foreground mt-1">{link.link_label}</p>}
        </div>
        <div className="text-[11px] text-muted-foreground text-right space-y-0.5">
          <p>Linked {formatDistanceToNow(new Date(link.created_at), { addSuffix: true })}</p>
          <p>Sync: {link.last_error ? "error" : link.last_synced_at ? "ok" : "not synced"}</p>
          {link.last_processed_ts && (
            <p>Last processed {link.last_processed_ts}</p>
          )}
          {link.last_synced_at && (
            <p>Synced {formatDistanceToNow(new Date(link.last_synced_at), { addSuffix: true })}</p>
          )}
          {link.sync_mode && <p className="capitalize">{link.sync_mode.replace(/_/g, " ")}</p>}
        </div>
      </div>
      {link.last_error && <p className="text-xs text-destructive">{link.last_error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy} onClick={onSync}>
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          Sync latest
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={onDisable}>
          Unlink
        </Button>
      </div>
      <SlackLinkDiagnostics
        projectId={projectId}
        link={link}
        syncResult={syncResult}
        reprocessResult={reprocessResult}
        onReprocess={onReprocess}
        reprocessBusy={reprocessBusy}
      />
    </div>
  );
}

export function ProjectSlackPanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data: workspaces = [] } = useSlackWorkspaces();
  const activeWorkspace = workspaces.find((w) => w.status === "active") ?? null;
  const { data: links = [] } = useProjectSlackLinks(projectId);
  const listChannels = useSlackListChannels();
  const linkChannel = useSlackLinkProjectChannel();
  const syncChannel = useSlackSyncProjectChannel();
  const reprocessSlackEvents = useReprocessSlackEvents();
  const updateLink = useUpdateProjectSlackLink();

  const [linkOpen, setLinkOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [linkType, setLinkType] = useState<ProjectSlackLinkType>("internal");
  const [linkLabel, setLinkLabel] = useState("");
  const [includeInAi, setIncludeInAi] = useState(true);
  const [includeInClientUpdates, setIncludeInClientUpdates] = useState(false);
  const [channels, setChannels] = useState<SlackChannelOption[]>([]);
  const [syncResults, setSyncResults] = useState<Record<string, SlackSyncProjectChannelResult>>({});
  const [reprocessResults, setReprocessResults] = useState<Record<string, ReprocessSlackEventsResult>>({});

  const activeLinks = links.filter((l) => l.status === "active");
  const grouped = useMemo(() => {
    const internal = activeLinks.filter((l) => l.link_type === "internal");
    const external = activeLinks.filter((l) => l.link_type === "external");
    const other = activeLinks.filter((l) => l.link_type === "other");
    return { internal, external, other };
  }, [activeLinks]);

  const busy =
    listChannels.isPending ||
    linkChannel.isPending ||
    syncChannel.isPending ||
    reprocessSlackEvents.isPending ||
    updateLink.isPending;

  const channelSelectOptions = useMemo(
    () =>
      channels.map((channel) => ({
        value: channel.id,
        label: channelOptionLabel(channel),
      })),
    [channels],
  );

  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? null;

  const resetLinkForm = () => {
    setSelectedChannelId("");
    setLinkType("internal");
    setLinkLabel("");
    setIncludeInAi(true);
    setIncludeInClientUpdates(false);
    setChannels([]);
  };

  const openLinkDialog = () => {
    resetLinkForm();
    setLinkOpen(true);
    void loadChannels();
  };

  const loadChannels = async (ensureChannelIds?: string[]) => {
    if (!activeWorkspace) return;
    try {
      const result = await listChannels.mutateAsync({
        slack_team_id: activeWorkspace.slack_team_id,
        include_private: true,
        ensure_channel_ids: ensureChannelIds?.filter(Boolean),
      });
      setChannels(result);
    } catch (e) {
      toast({ title: "Could not load channels", description: (e as Error).message, variant: "destructive" });
    }
  };

  const submitLink = async () => {
    if (!activeWorkspace || !selectedChannelId) return;
    try {
      await linkChannel.mutateAsync({
        project_id: projectId,
        slack_team_id: activeWorkspace.slack_team_id,
        slack_channel_id: selectedChannelId,
        link_type: linkType,
        link_label: linkLabel || undefined,
        include_in_ai: includeInAi,
        include_in_client_updates: includeInClientUpdates,
        is_client_facing: linkType === "external",
      });
      setLinkOpen(false);
      resetLinkForm();
      toast({ title: "Slack channel linked" });
    } catch (e) {
      toast({ title: "Could not link channel", description: (e as Error).message, variant: "destructive" });
    }
  };

  const syncLink = async (link: ProjectSlackLink) => {
    try {
      const result = await syncChannel.mutateAsync({
        project_id: projectId,
        project_slack_link_id: link.id,
      });
      setSyncResults((prev) => ({ ...prev, [link.id]: result }));
      toast({
        title: "Slack sync complete",
        description: `${result.imported_count} message(s), ${result.thread_replies_imported_count} thread reply(ies), ${result.meaningful_signals_count} meaningful signal(s).`,
      });
    } catch (e) {
      toast({ title: "Slack sync failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const reprocessLink = async (link: ProjectSlackLink) => {
    try {
      const result = await reprocessSlackEvents.mutateAsync({
        project_id: projectId,
        project_slack_link_id: link.id,
      });
      setReprocessResults((prev) => ({ ...prev, [link.id]: result }));
      toast({
        title: "Slack events reprocessed",
        description: `${result.signals_upserted} signal(s), ${result.meaningful_signals} meaningful, ${result.jobs_queued} job(s) queued.`,
      });
    } catch (e) {
      toast({ title: "Reprocess failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const disableLink = async (link: ProjectSlackLink) => {
    try {
      await updateLink.mutateAsync({ id: link.id, project_id: projectId, patch: { status: "disabled" } });
      toast({ title: "Slack channel disabled" });
    } catch (e) {
      toast({ title: "Could not disable channel", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Slack className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Slack Channels</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Link project channels for blockers, questions, decisions, and progress — not a message feed.
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1 text-xs" disabled={!activeWorkspace || busy} onClick={openLinkDialog}>
          <Link2 className="h-3.5 w-3.5" />
          Link Slack channel
        </Button>
      </div>

      {!activeWorkspace && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Slack workspace is not connected. A super admin can connect Slack from Settings.
          </AlertDescription>
        </Alert>
      )}

      {activeLinks.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4 text-center">
          No Slack channels linked yet.
        </p>
      ) : (
        <div className="space-y-4">
          {[
            { title: "Internal", items: grouped.internal },
            { title: "External / Client-facing", items: grouped.external },
            { title: "Other", items: grouped.other },
          ].map(
            (section) =>
              section.items.length > 0 && (
                <div key={section.title} className="space-y-2">
                  <h4 className="section-label">
                    {section.title}
                  </h4>
                  <div className="space-y-2">
                    {section.items.map((link) => (
                      <LinkCard
                        key={link.id}
                        link={link}
                        projectId={projectId}
                        busy={busy}
                        onSync={() => syncLink(link)}
                        onDisable={() => disableLink(link)}
                        onReprocess={() => reprocessLink(link)}
                        syncResult={syncResults[link.id]}
                        reprocessResult={reprocessResults[link.id]}
                        reprocessBusy={reprocessSlackEvents.isPending}
                      />
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>
      )}

      <Dialog
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          if (!open) resetLinkForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link Slack channel</DialogTitle>
            <DialogDescription>
              Choose a channel and classify it as internal or client-facing. External channels may contain
              client-visible messages.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Channel</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={!activeWorkspace || listChannels.isPending}
                  onClick={() => void loadChannels()}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${listChannels.isPending ? "animate-spin" : ""}`} />
                  Refresh channels
                </Button>
              </div>
              <SearchableSelect
                value={selectedChannelId}
                onChange={(value) => {
                  setSelectedChannelId(value);
                  const channel = channels.find((c) => c.id === value);
                  if (channel) setLinkType(channel.suggested_link_type);
                }}
                options={channelSelectOptions}
                placeholder={listChannels.isPending ? "Loading channels…" : "Select a channel"}
                searchPlaceholder="Search channels…"
                emptyText="No channels found."
                disabled={listChannels.isPending || channelSelectOptions.length === 0}
                inModal
              />
              <p className="text-xs text-muted-foreground">
                For private channels, invite the OXUS bot in Slack first, then refresh the list (in Slack:{" "}
                <span className="font-mono">/invite @YourBotName</span>). Direct messages and group DMs are not
                supported.
              </p>
            </div>
            {selectedChannel && !selectedChannel.is_member && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  The OXUS bot is not a member of this channel yet. Invite it in Slack before syncing messages.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={linkType} onValueChange={(v) => setLinkType(v as ProjectSlackLinkType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal</SelectItem>
                  <SelectItem value="external">External / Client-facing</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slack-label">Label (optional)</Label>
              <Input id="slack-label" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeInAi} onCheckedChange={(v) => setIncludeInAi(v === true)} />
              Include in AI analysis
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeInClientUpdates}
                onCheckedChange={(v) => setIncludeInClientUpdates(v === true)}
              />
              Use in client update context
            </label>
            {linkType === "external" && (
              <p className="text-xs text-muted-foreground">
                External channels may include client-facing messages. Only enable client update context if this
                channel is appropriate for client-visible summaries.
              </p>
            )}
            {linkType === "internal" && includeInClientUpdates && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Warning: this is an internal channel. Client update context may leak agency-only notes.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitLink()} disabled={!selectedChannelId || busy}>
              Link channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
