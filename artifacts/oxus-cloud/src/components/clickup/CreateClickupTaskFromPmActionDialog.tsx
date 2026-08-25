import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ClickupTaskConfirmationFields,
  clickupTaskFormToPayload,
  type ClickupTaskFormValues,
} from "@/components/clickup/ClickupTaskConfirmationFields";
import type { ProjectPmActionItem } from "@/lib/types";
import { pmActionClickupPrefill } from "@/lib/pmActions";
import { format } from "date-fns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ProjectPmActionItem | null;
  projectId: string;
  onConfirm: (input: ReturnType<typeof clickupTaskFormToPayload>) => Promise<void>;
  busy?: boolean;
  onRequestSetupUpdate?: () => void;
};

function metadataRecord(item: ProjectPmActionItem): Record<string, unknown> {
  const raw = item.source_metadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function CreateClickupTaskFromPmActionDialog({
  open,
  onOpenChange,
  item,
  projectId,
  onConfirm,
  busy,
  onRequestSetupUpdate,
}: Props) {
  const [values, setValues] = useState<ClickupTaskFormValues>({
    title: "",
    description: "",
    priority: "medium",
    status: "",
    assigneeIds: [],
    startDate: "",
    dueDate: "",
    estimateInput: "",
    tagNames: [],
  });
  const [sourceOpen, setSourceOpen] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    const prefill = pmActionClickupPrefill(item);
    setValues({
      title: prefill.title,
      description: prefill.description,
      priority: prefill.priority,
      assigneeIds: prefill.assigneeIds,
      startDate: "",
      dueDate: prefill.dueDate,
      estimateInput: "",
      tagNames: [],
      status: "",
    });
    setSourceOpen(false);
  }, [open, item]);

  const metadata = item ? metadataRecord(item) : {};
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const prefill = item ? pmActionClickupPrefill(item) : null;

  const confirm = async () => {
    const payload = clickupTaskFormToPayload(values);
    if (payload.error || !payload.title) return;
    await onConfirm(payload);
  };

  if (!item) return null;

  const payload = clickupTaskFormToPayload(values);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create in ClickUp</DialogTitle>
          <DialogDescription>Review and adjust task details before syncing to ClickUp.</DialogDescription>
        </DialogHeader>

        <ClickupTaskConfirmationFields
          projectId={projectId}
          open={open}
          values={values}
          onChange={setValues}
          busy={busy}
          onRequestSetupUpdate={onRequestSetupUpdate}
        />

        {prefill?.assigneeMatchNote && (
          <p className="text-xs text-muted-foreground">{prefill.assigneeMatchNote}</p>
        )}

        <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
          <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Source context
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
            {item.source_message && <p className="italic whitespace-pre-wrap">"{item.source_message}"</p>}
            <div className="flex flex-wrap gap-1 text-muted-foreground">
              {item.source_label && <span>{item.source_label}</span>}
              {item.source_actor_name && <span>· {item.source_actor_name}</span>}
              {item.source_message_ts && (
                <span>· {format(new Date(item.source_message_ts), "MMM d, h:mm a")}</span>
              )}
            </div>
            {attachments.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-foreground/80">Attachments</p>
                {attachments.map((att, idx) => {
                  if (!att || typeof att !== "object") return null;
                  const row = att as Record<string, unknown>;
                  const name =
                    (typeof row.name === "string" ? row.name : null) ??
                    (typeof row.title === "string" ? row.title : null) ??
                    "Attachment";
                  return <Badge key={idx} variant="outline" className="text-[10px] h-5">{name}</Badge>;
                })}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !values.title.trim() || !!payload.error}>
            {busy ? "Creating…" : "Create task in ClickUp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
