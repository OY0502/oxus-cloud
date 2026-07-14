import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  MoreHorizontal,
  RefreshCw,
  Settings,
  ShieldCheck,
  Zap,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UpdateClickupSetupDialog } from "@/components/clickup/UpdateClickupSetupDialog";
import { useToast } from "@/hooks/use-toast";
import { useClickupOAuthHandler } from "@/hooks/useClickupOAuthHandler";
import {
  useAuditClickupProjectSetup,
  useClickupDiagnostics,
  useClickupMyConnection,
  useClickupTeamSpaces,
  useEnsureProjectClickupSpace,
  useProjectClickupLink,
  useStartClickupOAuth,
  useSyncClickupMembers,
  useSyncClickupProjectSetup,
  type ClickupSetupUpdatePlan,
} from "@/hooks/api";
import { projectClickupOAuthReturnPath } from "@/lib/clickupOAuthReturn";
import { CLICKUP_TEMPLATE_VERSION } from "@/lib/clickup/template";

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

function setupStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "configured":
      return "Configured";
    case "needs_update":
      return "Update available";
    case "missing_required":
      return "Missing required fields";
    case "access_required":
      return "Access required";
    case "unverified":
      return "Configuration could not be verified";
    default:
      return "Not audited";
  }
}

function setupStatusVariant(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (status === "configured") return "default";
  if (status === "needs_update") return "secondary";
  if (status === "missing_required" || status === "access_required" || status === "unverified") return "destructive";
  return "outline";
}

type LinkMode = "create" | "existing";

export function ProjectClickupPanel({ projectId }: Props) {
  const { toast } = useToast();
  const { data: link, isLoading: linkLoading } = useProjectClickupLink(projectId);
  const { data: diagnostics } = useClickupDiagnostics(projectId);
  const { data: clickupStatus, refetch: refetchClickup } = useClickupMyConnection();
  const ensureSpace = useEnsureProjectClickupSpace();
  const auditSetup = useAuditClickupProjectSetup();
  const syncSetup = useSyncClickupProjectSetup();
  const syncMembers = useSyncClickupMembers();
  const startClickupOAuth = useStartClickupOAuth();
  const { handleError, startConnect } = useClickupOAuthHandler();

  const [linkMode, setLinkMode] = useState<LinkMode>("create");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>("");
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updatePlan, setUpdatePlan] = useState<ClickupSetupUpdatePlan | null>(null);
  const [diagnosticsSummary, setDiagnosticsSummary] = useState<string | null>(null);

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

  const runAudit = async () => {
    try {
      const result = await auditSetup.mutateAsync({ project_id: projectId });
      setUpdatePlan(result.update_plan);
      setDiagnosticsSummary(result.diagnostics_summary);
      toast({
        title: "ClickUp setup audited",
        description: `Status: ${setupStatusLabel(result.audit.status)}`,
      });
    } catch (e) {
      if (!handleError(e, "Could not audit ClickUp setup")) {
        toast({ title: "Audit failed", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const openUpdateDialog = async () => {
    try {
      const result = await auditSetup.mutateAsync({ project_id: projectId });
      setUpdatePlan(result.update_plan);
      setDiagnosticsSummary(result.diagnostics_summary);
      setUpdateDialogOpen(true);
    } catch (e) {
      if (!handleError(e, "Could not prepare ClickUp setup update")) {
        toast({ title: "Could not prepare update", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const confirmUpdate = async () => {
    try {
      const result = await syncSetup.mutateAsync({ project_id: projectId, confirm: true });
      setDiagnosticsSummary(result.diagnostics_summary);
      setUpdateDialogOpen(false);

      if (result.already_applied) {
        toast({
          title: "Already up to date",
          description: "This Space already matches the current OXUS template.",
        });
        return;
      }

      const updateResult = result.update_result;
      const isPartial = updateResult?.status === "partial";
      const isFailed = updateResult?.status === "failed";

      if (isFailed) {
        toast({
          title: "ClickUp setup update incomplete",
          description:
            updateResult?.warnings[0] ??
            "ClickUp rejected part of the setup update. Review diagnostics for details.",
          variant: "destructive",
        });
      } else {
        toast({
          title: isPartial ? "ClickUp setup partially updated" : "ClickUp setup updated",
          description: isPartial
            ? [
                updateResult?.enabled_automatically.length
                  ? `Enabled: ${updateResult.enabled_automatically.join(", ")}`
                  : null,
                updateResult?.requires_manual.length
                  ? `Manual: ${updateResult.requires_manual.join("; ")}`
                  : null,
              ]
                .filter(Boolean)
                .join(". ") || `Status: ${setupStatusLabel(result.audit.status)}`
            : `Applied ${result.applied_changes.length} change(s). Status: ${setupStatusLabel(result.audit.status)}`,
        });
      }

      try {
        const auditResult = await auditSetup.mutateAsync({ project_id: projectId });
        setDiagnosticsSummary(auditResult.diagnostics_summary);
      } catch {
        // Audit refresh is best-effort after a successful sync.
      }
    } catch (e) {
      if (!handleError(e, "Could not update ClickUp setup")) {
        toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const refreshMembers = async () => {
    try {
      const result = await syncMembers.mutateAsync({ project_id: projectId, force: true });
      toast({
        title: "Members refreshed",
        description: `${result.assignable_synced_count} assignable member(s) synced.`,
      });
    } catch (e) {
      if (!handleError(e, "Could not refresh members")) {
        toast({ title: "Refresh failed", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  const copyDiagnostics = async () => {
    const text = diagnosticsSummary ?? "Run Audit ClickUp setup to generate diagnostics.";
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Diagnostics copied" });
    } catch {
      toast({ title: "Could not copy diagnostics", variant: "destructive" });
    }
  };

  const meta = link?.metadata;
  const canLinkExisting = linkMode === "existing" && !!selectedSpaceId;
  const setupStatus = link?.clickup_setup_status;
  const needsUpdate = setupStatus === "needs_update" || setupStatus === "missing_required";

  const folderUrl =
    link?.clickup_folder_id && link.clickup_team_id
      ? `https://app.clickup.com/${link.clickup_team_id}/v/f/${link.clickup_folder_id}`
      : null;

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
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={setupStatusVariant(setupStatus)}>{setupStatusLabel(setupStatus)}</Badge>
              <span className="text-xs text-muted-foreground">
                Template v{link.clickup_template_version ?? "—"} / current v{CLICKUP_TEMPLATE_VERSION}
              </span>
              {link.clickup_setup_audited_at && (
                <span className="text-xs text-muted-foreground">
                  Last audited {formatDistanceToNow(new Date(link.clickup_setup_audited_at), { addSuffix: true })}
                </span>
              )}
            </div>

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
              {link.clickup_setup_updated_at && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="section-label mb-1">Last setup update</p>
                  <p className="text-sm font-medium">
                    {formatDistanceToNow(new Date(link.clickup_setup_updated_at), { addSuffix: true })}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {needsUpdate ? (
                <Button size="sm" onClick={openUpdateDialog} disabled={auditSetup.isPending || syncSetup.isPending}>
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  Update ClickUp setup
                </Button>
              ) : (
                <Button size="sm" variant="default" onClick={runAudit} disabled={auditSetup.isPending}>
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  Audit ClickUp setup
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={refreshMembers}
                disabled={syncMembers.isPending}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${syncMembers.isPending ? "animate-spin" : ""}`} />
                Refresh members
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {link.space_url && (
                    <DropdownMenuItem onClick={() => window.open(link.space_url!, "_blank")}>
                      Open Space in ClickUp
                    </DropdownMenuItem>
                  )}
                  {folderUrl && (
                    <DropdownMenuItem onClick={() => window.open(folderUrl, "_blank")}>
                      Open Folder
                    </DropdownMenuItem>
                  )}
                  {link.list_url && (
                    <DropdownMenuItem onClick={() => window.open(link.list_url!, "_blank")}>
                      Open List
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={runAudit}>View diagnostics</DropdownMenuItem>
                  <DropdownMenuItem onClick={copyDiagnostics}>
                    <Copy className="h-3.5 w-3.5 mr-2" />
                    Copy diagnostics
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/settings#clickup-account">Change connection</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                    <pre className="whitespace-pre-wrap font-mono text-[11px] bg-muted/40 rounded-md p-3">
                      {diagnosticsSummary ??
                        (link.clickup_setup_snapshot
                          ? JSON.stringify(link.clickup_setup_snapshot, null, 2)
                          : "Run Audit ClickUp setup to verify against ClickUp.")}
                    </pre>
                    <p>Workspace member count: {diagnostics?.workspaceMemberCount ?? "—"}</p>
                    <p>Project assignable member count: {diagnostics?.assignableMemberCount ?? "—"}</p>
                    <p>Webhook ID: <span className="font-mono">{link.clickup_webhook_id ?? "—"}</span></p>
                    <p>Registered webhook events: {metadataValue(meta, "webhook_events") ?? "—"}</p>
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
                        Creates a ClickUp space with the OXUS Delivery Template (features, Delivery folder, Tasks list).
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

      <UpdateClickupSetupDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        appliedTemplateVersion={link?.clickup_template_version ?? null}
        plan={updatePlan}
        busy={syncSetup.isPending}
        onConfirm={confirmUpdate}
      />
    </div>
  );
}
