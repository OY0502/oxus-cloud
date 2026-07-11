import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { SearchableMultiSelect } from "@/components/forms/SearchableMultiSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import type { AiProposedTask, AiProposedTaskPriority } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: AiProposedTask | null;
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

export function CreateClickupTaskDialog({
  open,
  onOpenChange,
  task,
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

  useEffect(() => {
    if (!open || !task) return;
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
    setPriority(task.priority ?? "medium");
    setStatus("");
    setAssigneeIds(task.selected_clickup_assignee_ids ?? []);
    setDueDate(task.selected_due_date ?? "");
    if (typeof task.estimate_hours === "number" && task.estimate_hours > 0) {
      const totalMinutes = Math.round(task.estimate_hours * 60);
      setEstimateHours(String(Math.floor(totalMinutes / 60)));
      setEstimateMinutes(String(totalMinutes % 60));
    } else {
      setEstimateHours("");
      setEstimateMinutes("");
    }
  }, [open, task]);

  const statusData = statusesQuery.data;
  const statusOptions = statusData?.statuses ?? [];
  const defaultStatus = statusData?.default_status ?? null;
  const notLinked = statusData ? statusData.linked === false : false;

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

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create in ClickUp</DialogTitle>
          <DialogDescription>Review and adjust task details before syncing to ClickUp.</DialogDescription>
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
            <Label htmlFor="ai-clickup-title">Task title</Label>
            <Input
              id="ai-clickup-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-clickup-description">Description</Label>
            <Textarea
              id="ai-clickup-description"
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-due-date">Due date</Label>
              <Input
                id="ai-due-date"
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !title.trim() || notLinked}>
            {busy ? "Creating…" : "Create Task in ClickUp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
