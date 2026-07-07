import React, { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ProjectPmActionItem } from "@/lib/types";
import { format, formatDistanceToNow } from "date-fns";

function metadataRecord(item: ProjectPmActionItem): Record<string, unknown> {
  const raw = item.source_metadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function payloadRecord(item: ProjectPmActionItem): Record<string, unknown> {
  const raw = item.action_payload;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function linkTypeBadge(linkType: string | null | undefined) {
  if (linkType === "external") return <Badge variant="secondary" className="text-[10px] h-5">External</Badge>;
  if (linkType === "internal") return <Badge variant="outline" className="text-[10px] h-5">Internal</Badge>;
  return null;
}

export function PmActionSourceContext({ item }: { item: ProjectPmActionItem }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const metadata = metadataRecord(item);
  const payload = payloadRecord(item);
  const sourceType = item.source_type ?? item.source;
  const linkType =
    (typeof metadata.link_type === "string" ? metadata.link_type : null) ??
    (typeof payload.link_type === "string" ? payload.link_type : null);

  const originalMessage =
    (typeof payload.original_message === "string" ? payload.original_message : null) ??
    item.source_message;
  const latestMessage =
    typeof payload.latest_relevant_message === "string" ? payload.latest_relevant_message : null;
  const signalType =
    (typeof payload.signal_type === "string" ? payload.signal_type : null) ??
    (typeof metadata.signal_type === "string" ? metadata.signal_type : null);

  const hasSourceContext =
    sourceType === "slack" ||
    sourceType === "clickup" ||
    Boolean(originalMessage) ||
    Boolean(item.source_label);

  if (!hasSourceContext) return null;

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-2 space-y-2 text-[11px]">
      {sourceType === "slack" && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-[10px] h-5">Slack</Badge>
            {item.source_label && <span className="text-muted-foreground">{item.source_label}</span>}
            {linkTypeBadge(linkType)}
            {typeof metadata.actor_classification === "string" && (
              <Badge variant="secondary" className="text-[10px] h-5 capitalize">
                {metadata.actor_classification}
              </Badge>
            )}
          </div>
          {(item.source_actor_name || item.source_message_ts) && (
            <p className="text-muted-foreground">
              {item.source_actor_name && <span>{item.source_actor_name}</span>}
              {item.source_message_ts && (
                <span>
                  {item.source_actor_name ? " · " : ""}
                  {format(new Date(item.source_message_ts), "MMM d, h:mm a")}
                  {" · "}
                  {formatDistanceToNow(new Date(item.source_message_ts), { addSuffix: true })}
                </span>
              )}
            </p>
          )}
          {originalMessage && (
            <p className="text-foreground/90 italic whitespace-pre-wrap">"{originalMessage}"</p>
          )}
          {latestMessage && latestMessage !== originalMessage && (
            <p className="text-muted-foreground">
              Latest thread update: <span className="italic">"{latestMessage}"</span>
            </p>
          )}
          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open in Slack <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {Array.isArray(metadata.attachments) && metadata.attachments.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-muted-foreground font-medium">Attachments</p>
              {metadata.attachments.map((att, idx) => {
                if (!att || typeof att !== "object") return null;
                const row = att as Record<string, unknown>;
                const name =
                  (typeof row.name === "string" ? row.name : null) ??
                  (typeof row.title === "string" ? row.title : null) ??
                  "Attachment";
                const mime =
                  (typeof row.mimetype === "string" ? row.mimetype : null) ??
                  (typeof row.filetype === "string" ? row.filetype : null) ??
                  "unknown type";
                return (
                  <p key={idx} className="text-muted-foreground">
                    {name} · {mime}
                  </p>
                );
              })}
              <p className="text-[10px] italic">Slack attachment metadata captured</p>
            </div>
          )}
        </div>
      )}

      {sourceType === "clickup" && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-[10px] h-5">ClickUp</Badge>
            {item.source_label && <span>{item.source_label}</span>}
          </div>
          {item.source_message && (
            <p className="text-foreground/90 whitespace-pre-wrap">{item.source_message}</p>
          )}
          {(item.source_actor_name || item.source_message_ts) && (
            <p className="text-muted-foreground">
              {item.source_actor_name}
              {item.source_message_ts &&
                ` · ${format(new Date(item.source_message_ts), "MMM d, h:mm a")}`}
            </p>
          )}
          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open in ClickUp <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      <Collapsible open={whyOpen} onOpenChange={setWhyOpen}>
        <CollapsibleTrigger className="text-[10px] text-muted-foreground hover:text-foreground">
          Why this exists
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1 space-y-1 text-muted-foreground">
          {item.description && <p>{item.description}</p>}
          {signalType && <p>Signal type: {signalType.replace(/_/g, " ")}</p>}
          {typeof payload.suggested_action_type === "string" && (
            <p>Suggested action: {payload.suggested_action_type.replace(/_/g, " ")}</p>
          )}
          {typeof payload.action_family === "string" && (
            <p>Action family: {payload.action_family.replace(/_/g, " ")}</p>
          )}
          {typeof payload.action_identity === "string" && (
            <p className="font-mono text-[10px] break-all">Identity: {payload.action_identity}</p>
          )}
          {typeof metadata.confidence === "number" && (
            <p>Confidence: {Math.round(metadata.confidence * 100)}%</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
