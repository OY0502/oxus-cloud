import React, { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert, Database } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useProjectChatVectorSync, useProjectClickupLink, useProjectSlackLinks, useStartClickupInitialProjectScan } from "@/hooks/api";
import { cn } from "@/lib/utils";

function relativeTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

function syncedOn(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

function SourceRow({
  label,
  connected,
  syncedAt,
  detail,
  compact,
}: {
  label: string;
  connected: boolean;
  syncedAt?: string | null;
  detail?: string;
  compact?: boolean;
}) {
  const syncLabel = syncedOn(syncedAt);
  const healthy = connected && !!syncLabel;
  return (
    <div className={cn("text-xs", compact ? "py-1.5" : "py-2")}>
      <div className="flex items-start gap-2">
        {healthy ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-soft-green" />
        ) : (
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warm-yellow" />
        )}
        <div className="min-w-0">
          <p className="font-medium text-foreground">{label}</p>
          <p className={cn("mt-0.5 text-[11px] leading-4 text-muted-foreground", !connected && "italic")}>
            {detail ?? (!connected ? "Not connected" : syncLabel ? `Synced on ${syncLabel}` : "Waiting for first sync")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ProjectContextStatus({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const { data: clickupLink } = useProjectClickupLink(projectId);
  const { data: slackLinks = [] } = useProjectSlackLinks(projectId);
  const { data: vectorSync } = useProjectChatVectorSync(projectId);
  const startInitialScan = useStartClickupInitialProjectScan();
  const attemptedInitialScan = useRef<string | null>(null);
  const slackLink = slackLinks.find((link) => link.status === "active") ?? slackLinks[0];
  const vectorMetadata = vectorSync?.metadata && typeof vectorSync.metadata === "object" && !Array.isArray(vectorSync.metadata)
    ? vectorSync.metadata as Record<string, unknown>
    : {};
  const retrievalMode = typeof vectorMetadata.retrieval_mode === "string" ? vectorMetadata.retrieval_mode : "shadow";
  const clickupMetadata = clickupLink?.metadata && typeof clickupLink.metadata === "object" && !Array.isArray(clickupLink.metadata)
    ? clickupLink.metadata as Record<string, unknown>
    : {};
  const clickupScanStatus = typeof clickupMetadata.initial_scan_status === "string" ? clickupMetadata.initial_scan_status : null;

  useEffect(() => {
    if (!clickupLink?.id || clickupLink.status !== "active" || clickupLink.last_sync_at) return;
    if (clickupScanStatus === "queued" || clickupScanStatus === "running" || clickupScanStatus === "completed") return;
    if (attemptedInitialScan.current === clickupLink.id) return;
    attemptedInitialScan.current = clickupLink.id;
    startInitialScan.mutate({ project_id: projectId });
  }, [clickupLink?.id, clickupLink?.last_sync_at, clickupLink?.status, clickupScanStatus, projectId]);
  const clickupDetail = clickupLink?.last_sync_at
    ? undefined
    : clickupScanStatus === "queued"
      ? "Connected · task scan queued"
      : clickupScanStatus === "running"
        ? "Connected · scanning existing tasks…"
        : clickupScanStatus === "failed"
          ? "Connected · initial task scan needs retry"
          : clickupLink?.status === "active"
            ? "Connected · preparing project context"
            : undefined;

  const dates = [clickupLink?.last_sync_at, slackLink?.last_synced_at, vectorSync?.last_indexed_at]
    .filter((value): value is string => !!value)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const newest = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;

  return (
    <section className={cn(
      "rounded-lg",
      compact ? "bg-info-muted/60 p-3" : "border border-border/70 bg-muted/20 p-3.5",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-background/80 p-1.5 text-info">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Connected context</h3>
            <p className="text-xs text-muted-foreground">
              {newest
                ? `Latest connected sync ${relativeTime(newest)}`
                : clickupLink?.status === "active"
                  ? "ClickUp connected · project context is preparing"
                  : "No connected source has synced yet"}
            </p>
          </div>
        </div>
        <span className="mt-1.5 inline-flex h-2 w-2 rounded-full bg-success" aria-label="Context status" />
      </div>
      <div className={cn("mt-2", compact ? "grid gap-x-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2" : "divide-y divide-border/60")}>
        <SourceRow compact={compact} label="ClickUp" connected={clickupLink?.status === "active"} syncedAt={clickupLink?.last_sync_at} detail={clickupDetail} />
        <SourceRow compact={compact} label="Slack" connected={slackLink?.status === "active"} syncedAt={slackLink?.last_synced_at} />
        <SourceRow
          compact={compact}
          label="Pinecone knowledge index"
          connected={vectorSync?.status === "ready"}
          syncedAt={vectorSync?.last_indexed_at}
          detail={
            vectorSync?.status === "ready"
              ? `${vectorSync.vector_count} indexed passage records · ${retrievalMode === "primary" ? "Primary retrieval" : "Shadow evaluation"} · ${vectorSync.last_indexed_at ? `Synced on ${syncedOn(vectorSync.last_indexed_at)}` : "Ready"}`
              : vectorSync?.status === "syncing"
                ? "Indexing project knowledge…"
                : vectorSync?.status === "degraded"
                  ? "Supabase fallback is active"
                  : "Ready after Pinecone is connected"
          }
        />
      </div>
    </section>
  );
}
