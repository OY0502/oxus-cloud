import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { SearchableMultiSelect } from "@/components/forms/SearchableMultiSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useClickupAssignableMembers, useClickupListStatuses, useSyncClickupMembers } from "@/hooks/api";
import type { AiProposedTaskPriority, ProjectPmActionItem } from "@/lib/types";
import { pmActionClickupPrefill } from "@/lib/pmActions";
import { format } from "date-fns";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ProjectPmActionItem | null;
  projectId: string;
  teamId: string | undefined;
  onConfirm: (input: {
    title: string;
    description?: string;
    priority: AiProposedTaskPriority;
    status?: string;
    assignee_ids: string[];
    due_date?: string;
    time_estimate_minutes?: number;
  }) => Promise<void>;
  busy?: boolean;
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
  teamId,
  onConfirm,
  busy,
}: Props) {
  const { data: members = [], isLoading: membersLoading } = useClickupAssignableMembers(projectId);
  const syncMembers = useSyncClickupMembers();
  const statusesQuery = useClickupListStatuses(projectId, open);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<AiProposedTaskPriority>("medium");
  const [status, setStatus] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [estimateHours, setEstimateHours] = useState("");
  const [estimateMinutes, setEstimateMinutes] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);

  useEffect(() => {
    if (!open || !item) return;
    const prefill = pmActionClickupPrefill(item);
    setTitle(prefill.title);
    setDescription(prefill.description);
    setPriority(prefill.priority);
    setAssigneeIds(prefill.assigneeIds);
    setDueDate(prefill.dueDate);
    setStatus("");
    setEstimateHours("");
    setEstimateMinutes("");
    setSourceOpen(false);
  }, [open, item]);

  const statusData = statusesQuery.data;
  const statusOptions = statusData?.statuses ?? [];
  const defaultStatus = statusData?.default_status ?? null;
  const notLinked = statusData ? statusData.linked === false : false;

  // Default the status dropdown to the list default once statuses load.
  useEffect(() => {
    if (!open) return;
    if (!status && defaultStatus) setStatus(defaultStatus);
  }, [open, status, defaultStatus]);

  useEffect(() => {
    if (open && projectId && members.length === 0 && !membersLoading && !syncMembers.isPending) {
      syncMembers.mutate({ project_id: projectId });
    }
  }, [open, projectId, members.length, membersLoading, syncMembers]);

  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.clickup_user_id,
        label: member.name ?? member.email ?? member.clickup_user_id,
        sublabel: member.email ?? undefined,
      })),
    [members],
  );

  const metadata = item ? metadataRecord(item) : {};
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const prefill = item ? pmActionClickupPrefill(item) : null;

  const timeEstimateMinutes = useMemo(() => {
    const h = Number.parseInt(estimateHours, 10);
    const m = Number.parseInt(estimateMinutes, 10);
    const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    return total > 0 ? total : undefined;
  }, [estimateHours, estimateMinutes]);

  const confirm = async () => {
    if (!title.trim() || notLinked) return;
    await onConfirm({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status: status || undefined,
      assignee_ids: assigneeIds,
      due_date: dueDate || undefined,
      time_estimate_minutes: timeEstimateMinutes,
    });
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create in ClickUp</DialogTitle>
          <DialogDescription>
            Review and adjust task details before syncing to ClickUp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {notLinked && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {statusData?.message ??
                  "This project is not linked to a ClickUp list yet. Sync the ClickUp structure before creating tasks."}
              </AlertDescription>
            </Alert>
          )}

          {statusData?.destination && (
            <p className="text-xs text-muted-foreground">
              Destination:{" "}
              <span className="font-medium text-foreground">
                {[statusData.destination.space_name, statusData.destination.folder_name, statusData.destination.list_name]
                  .filter(Boolean)
                  .join(" / ") || "ClickUp list"}
              </span>
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="pm-clickup-title">Task title</Label>
            <Input
              id="pm-clickup-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pm-clickup-description">Description</Label>
            <Textarea
              id="pm-clickup-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              disabled={busy}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as AiProposedTaskPriority)} disabled={busy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={setStatus}
                disabled={busy || statusesQuery.isPending || statusOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={statusesQuery.isPending ? "Loading…" : "List default"} />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s.status} value={s.status}>
                      {s.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {statusOptions.length === 0 && !statusesQuery.isPending && !notLinked && (
                <p className="text-xs text-muted-foreground">Statuses unavailable — the list default will be used.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Assignees</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs"
                disabled={syncMembers.isPending}
                onClick={() => syncMembers.mutate({ project_id: projectId, force: true })}
              >
                <RefreshCw className={`h-3 w-3 ${syncMembers.isPending ? "animate-spin" : ""}`} />
                Refresh members
              </Button>
            </div>
            <SearchableMultiSelect
              values={assigneeIds}
              onChange={setAssigneeIds}
              options={memberOptions}
              placeholder={membersLoading || syncMembers.isPending ? "Loading members…" : "Select ClickUp assignees…"}
              searchPlaceholder="Search members…"
              emptyText="No assignable ClickUp members found for this project Space/List. Share the ClickUp Space with teammates, then refresh members."
              disabled={membersLoading || syncMembers.isPending || busy}
            />
            <p className="text-xs text-muted-foreground">
              Only members with access to the connected ClickUp Space/List are shown.
            </p>
            {prefill?.assigneeMatchNote && (
              <p className="text-xs text-muted-foreground">{prefill.assigneeMatchNote}</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pm-clickup-due-date">Due date</Label>
              <Input
                id="pm-clickup-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label>Time estimate</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={estimateHours}
                  onChange={(e) => setEstimateHours(e.target.value)}
                  placeholder="0"
                  disabled={busy}
                  aria-label="Estimate hours"
                />
                <span className="text-xs text-muted-foreground">h</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={estimateMinutes}
                  onChange={(e) => setEstimateMinutes(e.target.value)}
                  placeholder="0"
                  disabled={busy}
                  aria-label="Estimate minutes"
                />
                <span className="text-xs text-muted-foreground">m</span>
              </div>
            </div>
          </div>

          <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
            <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground">
              Source context
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
              {item.source_message && (
                <p className="italic whitespace-pre-wrap">"{item.source_message}"</p>
              )}
              <div className="flex flex-wrap gap-1 text-muted-foreground">
                {item.source_label && <span>{item.source_label}</span>}
                {item.source_actor_name && <span>· {item.source_actor_name}</span>}
                {item.source_message_ts && (
                  <span>· {format(new Date(item.source_message_ts), "MMM d, h:mm a")}</span>
                )}
                {prefill?.suggestedDueDateText && (
                  <span>· Due: {prefill.suggestedDueDateText}</span>
                )}
                {prefill?.suggestedAssigneeNames.length ? (
                  <span>· Suggested assignee: {prefill.suggestedAssigneeNames.join(", ")}</span>
                ) : null}
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
                    const mime =
                      (typeof row.mimetype === "string" ? row.mimetype : null) ??
                      (typeof row.filetype === "string" ? row.filetype : null) ??
                      "unknown type";
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] h-5">{name}</Badge>
                        <span className="text-muted-foreground">{mime}</span>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-muted-foreground italic">Slack attachment metadata captured</p>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !title.trim() || notLinked}>
            {busy ? "Creating…" : "Create task in ClickUp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
