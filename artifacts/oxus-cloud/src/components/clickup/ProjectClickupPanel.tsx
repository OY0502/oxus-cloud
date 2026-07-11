import React, { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Link2, Settings, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useClickupOAuthHandler } from "@/hooks/useClickupOAuthHandler";
import {
  useClickupDiagnostics,
  useClickupMyConnection,
  useClickupTeamSpaces,
  useEnsureProjectClickupSpace,
  useProjectClickupLink,
  useStartClickupOAuth,
} from "@/hooks/api";
import { projectClickupOAuthReturnPath } from "@/lib/clickupOAuthReturn";

interface Props {
  projectId: string;
}

function metadataValue(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? null : String(value);
}

type LinkMode = "create" | "existing";

export function ProjectClickupPanel({ projectId }: Props) {
  const { toast } = useToast();
  const { data: link, isLoading: linkLoading } = useProjectClickupLink(projectId);
  const { data: diagnostics } = useClickupDiagnostics(projectId);
  const { data: clickupStatus, refetch: refetchClickup } = useClickupMyConnection();
  const ensureSpace = useEnsureProjectClickupSpace();
  const startClickupOAuth = useStartClickupOAuth();
  const { handleError, startConnect } = useClickupOAuthHandler();

  const [linkMode, setLinkMode] = useState<LinkMode>("create");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>("");

  const accountConnected = clickupStatus?.connected === true;
  const { data: spaces = [], isLoading: spacesLoading } = useClickupTeamSpaces(
    projectId,
    accountConnected && !link,
  );

  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === selectedSpaceId) ?? null,
    [spaces, selectedSpaceId],
  );

  const connectAccount = async () => {
    try {
      await startConnect(() =>
        startClickupOAuth.mutateAsync({ redirect_after: projectClickupOAuthReturnPath(projectId) }),
      );
    } catch (e) {
      handleError(e, "Could not start ClickUp connection");
    }
  };

  const handleLinkSpace = async () => {
    try {
      const result = await ensureSpace.mutateAsync(
        linkMode === "existing" && selectedSpaceId
          ? {
              project_id: projectId,
              clickup_space_id: selectedSpaceId,
              space_name: selectedSpace?.name,
            }
          : { project_id: projectId },
      );
      toast({
        title: linkMode === "existing" ? "ClickUp space linked" : "ClickUp space created",
        description: result.created
          ? linkMode === "existing"
            ? `Linked "${result.link.space_name}" with Delivery → Tasks list.`
            : `Space "${result.link.space_name}" with Delivery → Tasks list is ready.`
          : "ClickUp space is already linked to this project.",
      });
      void refetchClickup();
    } catch (e) {
      if (!handleError(e, "Failed to link ClickUp space")) {
        toast({ title: "Failed to link ClickUp space", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const meta = link?.metadata;
  const canLinkExisting = linkMode === "existing" && !!selectedSpaceId;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">ClickUp Execution Space</h3>
            <p className="text-xs text-muted-foreground">
              OXUS AI tasks are created in ClickUp for execution. Link a workspace space for this project.
            </p>
          </div>
        </div>

        {linkLoading ? (
          <p className="text-sm text-muted-foreground">Loading ClickUp link...</p>
        ) : link ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {link.space_name && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="section-label mb-1">Space</p>
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-medium">{link.space_name}</p>
                    {link.space_url && (
                      <a href={link.space_url} target="_blank" rel="noopener noreferrer" className="text-primary">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}
              {link.folder_name && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="section-label mb-1">Folder</p>
                  <p className="text-sm font-medium">{link.folder_name}</p>
                </div>
              )}
              {link.list_name && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="section-label mb-1">List</p>
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-medium">{link.list_name}</p>
                    {link.list_url && (
                      <a href={link.list_url} target="_blank" rel="noopener noreferrer" className="text-primary">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}
              {link.last_sync_at && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="section-label mb-1">Last sync</p>
                  <p className="text-sm font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    {formatDistanceToNow(new Date(link.last_sync_at), { addSuffix: true })}
                  </p>
                </div>
              )}
            </div>

            {link.last_error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Sync error</AlertTitle>
                <AlertDescription className="text-xs">{link.last_error}</AlertDescription>
              </Alert>
            )}

            <Accordion type="single" collapsible>
              <AccordionItem value="diagnostics" className="border-0">
                <AccordionTrigger className="text-xs text-muted-foreground hover:no-underline py-1">
                  Diagnostics
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p>Project ClickUp link: <Badge variant="outline" className="text-[10px] h-5">connected</Badge></p>
                    <p>Space ID: <span className="font-mono">{link.clickup_space_id ?? "—"}</span></p>
                    <p>List ID: <span className="font-mono">{link.clickup_list_id ?? "—"}</span></p>
                    <p>Webhook ID: <span className="font-mono">{link.clickup_webhook_id ?? "—"}</span></p>
                    <p>Registered webhook events: {metadataValue(meta, "webhook_events") ?? "—"}</p>
                    <p>Webhook scope: {metadataValue(meta, "webhook_scope") ?? "—"}</p>
                    <p>Webhook created: {metadataValue(meta, "webhook_created_at") ?? "—"}</p>
                    <p>Last webhook received: {metadataValue(meta, "last_webhook_received_at") ?? "—"}</p>
                    <p>Last webhook event: {metadataValue(meta, "last_webhook_event_type") ?? "—"}</p>
                    <p>Last webhook mapped: {metadataValue(meta, "last_webhook_mapped") ?? "—"}</p>
                    <p>Last webhook error: {metadataValue(meta, "last_webhook_error") ?? "—"}</p>
                    <p>Last manual sync: {metadataValue(meta, "last_manual_sync_at") ?? "—"}</p>
                    <p>Last manual sync imported: {metadataValue(meta, "last_manual_sync_imported_count") ?? "—"} comments</p>
                    <p>Needs comment fetch: {metadataValue(meta, "needs_comment_fetch") ?? "false"}</p>
                    <p>Workspace member count: {diagnostics?.workspaceMemberCount ?? "—"}</p>
                    <p>Project assignable member count: {diagnostics?.assignableMemberCount ?? "—"}</p>
                    <p>Hidden workspace members: {diagnostics?.hiddenWorkspaceMemberCount ?? "—"}</p>
                    <p>
                      Linked Space:{" "}
                      {diagnostics?.assignableMembersSync?.linked_space_name ??
                        link.space_name ??
                        diagnostics?.assignableMembersSync?.linked_space_id ??
                        link.clickup_space_id ??
                        "—"}
                    </p>
                    <p>
                      Linked Folder:{" "}
                      {diagnostics?.assignableMembersSync?.linked_folder_name ??
                        link.folder_name ??
                        diagnostics?.assignableMembersSync?.linked_folder_id ??
                        link.clickup_folder_id ??
                        "—"}
                    </p>
                    <p>
                      Linked List:{" "}
                      {diagnostics?.assignableMembersSync?.linked_list_name ??
                        link.list_name ??
                        diagnostics?.assignableMembersSync?.linked_list_id ??
                        link.clickup_list_id ??
                        "—"}
                    </p>
                    <p>
                      Assignable member sync source:{" "}
                      {diagnostics?.assignableMembersSync?.sync_source ?? "—"}
                      {diagnostics?.assignableMembersSync?.confidence
                        ? ` (${diagnostics.assignableMembersSync.confidence} confidence)`
                        : ""}
                    </p>
                    {diagnostics?.lastWebhookEvent && (
                      <p>
                        Latest stored webhook: {diagnostics.lastWebhookEvent.event_type} on task {diagnostics.lastWebhookEvent.clickup_task_id}{" "}
                        ({formatDistanceToNow(new Date(diagnostics.lastWebhookEvent.created_at), { addSuffix: true })})
                        {diagnostics.lastWebhookEvent.processing_error && (
                          <span className="text-destructive"> — {diagnostics.lastWebhookEvent.processing_error}</span>
                        )}
                      </p>
                    )}
                    {diagnostics?.lastTimelineEvent && (
                      <p>
                        Latest timeline event: {diagnostics.lastTimelineEvent.event_type} — {diagnostics.lastTimelineEvent.event_title}{" "}
                        ({formatDistanceToNow(new Date(diagnostics.lastTimelineEvent.created_at), { addSuffix: true })})
                      </p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="details" className="border-0">
                <AccordionTrigger className="text-xs text-muted-foreground hover:no-underline py-1">
                  Technical details
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1 text-xs text-muted-foreground font-mono">
                    <p>Team ID: {link.clickup_team_id}</p>
                    <p>Space ID: {link.clickup_space_id ?? "—"}</p>
                    <p>List ID: {link.clickup_list_id ?? "—"}</p>
                    {link.clickup_webhook_id && <p>Webhook ID: {link.clickup_webhook_id}</p>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        ) : (
          <div className="space-y-4">
            {!accountConnected ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect your ClickUp account first, then choose to create a new space or link an existing one for this project.
                </p>
                <Button onClick={connectAccount} disabled={startClickupOAuth.isPending} className="gap-2">
                  <Link2 className="h-4 w-4" />
                  {startClickupOAuth.isPending ? "Starting connection…" : "Connect ClickUp account"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  No ClickUp space is linked yet. Create a dedicated space or connect one you already use in ClickUp.
                </p>
                <RadioGroup
                  value={linkMode}
                  onValueChange={(value) => setLinkMode(value as LinkMode)}
                  className="space-y-3"
                >
                  <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
                    <RadioGroupItem value="create" id="clickup-link-create" className="mt-0.5" />
                    <Label htmlFor="clickup-link-create" className="space-y-1 cursor-pointer">
                      <span className="text-sm font-medium">Create new space</span>
                      <p className="text-xs text-muted-foreground font-normal">
                        Creates a ClickUp space with Delivery folder and Tasks list for this project.
                      </p>
                    </Label>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
                    <RadioGroupItem value="existing" id="clickup-link-existing" className="mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="clickup-link-existing" className="space-y-1 cursor-pointer">
                        <span className="text-sm font-medium">Use existing space</span>
                        <p className="text-xs text-muted-foreground font-normal">
                          Pick a space from your ClickUp workspace. OXUS will add Delivery → Tasks if missing.
                        </p>
                      </Label>
                      {linkMode === "existing" && (
                        <Select value={selectedSpaceId} onValueChange={setSelectedSpaceId}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder={spacesLoading ? "Loading spaces…" : "Select a space"} />
                          </SelectTrigger>
                          <SelectContent>
                            {spaces.map((space) => (
                              <SelectItem key={space.id} value={space.id}>{space.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {linkMode === "existing" && !spacesLoading && spaces.length === 0 && (
                        <p className="text-xs text-muted-foreground">No spaces found in your ClickUp workspace.</p>
                      )}
                    </div>
                  </div>
                </RadioGroup>
                <Button
                  onClick={handleLinkSpace}
                  disabled={ensureSpace.isPending || (linkMode === "existing" && !canLinkExisting)}
                  className="gap-2"
                >
                  <Zap className="h-4 w-4" />
                  {ensureSpace.isPending
                    ? "Linking ClickUp space…"
                    : linkMode === "existing"
                      ? "Link existing space"
                      : "Create ClickUp space"}
                </Button>
              </>
            )}

            {ensureSpace.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Failed to link ClickUp space</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap">{ensureSpace.error.message}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        If you need to disconnect or change the connected ClickUp workspace, go to Settings → Integrations.{" "}
        <Link
          href="/settings#clickup-account"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <Settings className="h-3 w-3" />
          Open Settings
        </Link>
      </p>
    </div>
  );
}
