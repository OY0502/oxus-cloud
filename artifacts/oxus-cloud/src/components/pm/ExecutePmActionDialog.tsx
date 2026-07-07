import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SearchableMultiSelect } from "@/components/forms/SearchableMultiSelect";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useAiProposedTasks,
  useClickupMembers,
  useClickupTaskLinks,
  useSyncClickupMembers,
} from "@/hooks/api";
import type { ExecutePmActionInput } from "@/hooks/api";
import type { ProjectPmActionItem } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ProjectPmActionItem | null;
  projectId: string;
  teamId: string | undefined;
  onExecute: (input: ExecutePmActionInput) => Promise<void>;
  busy?: boolean;
};

function payloadTaskIds(item: ProjectPmActionItem | null): string[] {
  if (!item?.action_payload?.clickup_task_ids) return [];
  return item.action_payload.clickup_task_ids;
}

export function ExecutePmActionDialog({
  open,
  onOpenChange,
  item,
  projectId,
  teamId,
  onExecute,
  busy,
}: Props) {
  const { data: taskLinks = [] } = useClickupTaskLinks(projectId);
  const { data: proposedTasks = [] } = useAiProposedTasks(projectId);
  const { data: members = [] } = useClickupMembers(teamId);
  const syncMembers = useSyncClickupMembers();

  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [dueDateTime, setDueDateTime] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [selectedAiTaskIds, setSelectedAiTaskIds] = useState<string[]>([]);
  const memberSyncKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      memberSyncKeyRef.current = null;
      return;
    }
    if (!item) return;
    setSelectedTaskIds(payloadTaskIds(item));
    setAssigneeIds([]);
    setDueDate(item.action_payload?.suggested_due_date ?? "");
    setDueDateTime(false);
    setCommentText(item.action_payload?.suggested_comment ?? item.description ?? "");
    setSelectedAiTaskIds(item.action_payload?.ai_proposed_task_ids ?? []);
  }, [open, item]);

  useEffect(() => {
    if (!open || !item || !teamId || members.length > 0) return;
    const needsMembers =
      item.action_type === "assign_clickup_tasks" || item.action_type === "create_clickup_task";
    if (!needsMembers) return;

    const syncKey = `${item.id}:${teamId}`;
    if (memberSyncKeyRef.current === syncKey) return;
    memberSyncKeyRef.current = syncKey;
    syncMembers.mutate({ project_id: projectId });
  }, [open, item, teamId, members.length, projectId, syncMembers.mutate]);

  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.clickup_user_id,
        label: member.username ?? member.email ?? member.clickup_user_id,
        sublabel: member.email ?? undefined,
      })),
    [members],
  );

  const taskOptions = useMemo(
    () =>
      taskLinks.map((link) => ({
        value: link.clickup_task_id,
        label: link.clickup_task_name ?? link.clickup_task_id,
        sublabel: link.clickup_status ?? undefined,
      })),
    [taskLinks],
  );

  const aiTaskOptions = useMemo(
    () =>
      proposedTasks
        .filter((task) => task.status === "pending" && task.clickup_sync_status !== "synced")
        .map((task) => ({
          value: task.id,
          label: task.title,
          sublabel: task.priority,
        })),
    [proposedTasks],
  );

  if (!item) return null;

  const actionType = item.action_type ?? "manual";
  const titleByType: Record<string, string> = {
    assign_clickup_tasks: "Assign in ClickUp",
    update_clickup_deadline: "Set deadline in ClickUp",
    add_clickup_comment: "Comment in ClickUp",
    create_clickup_task: "Create task(s) in ClickUp",
  };

  const submit = async () => {
    await onExecute({
      action_item_id: item.id,
      project_id: projectId,
      execution_payload: {
        assignee_ids: assigneeIds,
        due_date: dueDate || undefined,
        due_date_time: dueDateTime,
        comment_text: commentText || undefined,
        selected_clickup_task_ids: selectedTaskIds,
        selected_ai_proposed_task_ids: selectedAiTaskIds,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titleByType[actionType] ?? "Execute action"}</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(actionType === "assign_clickup_tasks" ||
            actionType === "update_clickup_deadline" ||
            actionType === "add_clickup_comment") && (
            <div className="space-y-2">
              <Label>ClickUp tasks</Label>
              <SearchableMultiSelect
                values={selectedTaskIds}
                onChange={setSelectedTaskIds}
                options={taskOptions}
                placeholder="Select ClickUp tasks…"
                searchPlaceholder="Search tasks…"
                emptyText="No linked ClickUp tasks."
                disabled={busy}
              />
            </div>
          )}

          {actionType === "assign_clickup_tasks" && (
            <>
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
                  placeholder="Select assignees…"
                  searchPlaceholder="Search members…"
                  emptyText="No ClickUp members cached yet."
                  disabled={busy || syncMembers.isPending}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pm-due-date">Optional due date</Label>
                  <Input id="pm-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={dueDateTime} onCheckedChange={(v) => setDueDateTime(v === true)} disabled={busy || !dueDate} />
                    Include due time
                  </label>
                </div>
              </div>
            </>
          )}

          {actionType === "update_clickup_deadline" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="deadline-date">Due date</Label>
                <Input id="deadline-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={dueDateTime} onCheckedChange={(v) => setDueDateTime(v === true)} disabled={busy || !dueDate} />
                  Include due time
                </label>
              </div>
            </div>
          )}

          {actionType === "add_clickup_comment" && (
            <div className="space-y-2">
              <Label htmlFor="comment-text">Comment</Label>
              <Textarea id="comment-text" value={commentText} onChange={(e) => setCommentText(e.target.value)} rows={5} disabled={busy} />
            </div>
          )}

          {actionType === "create_clickup_task" && (
            <div className="space-y-2">
              <Label>AI proposed tasks</Label>
              <SearchableMultiSelect
                values={selectedAiTaskIds}
                onChange={setSelectedAiTaskIds}
                options={aiTaskOptions}
                placeholder="Select AI proposed tasks…"
                searchPlaceholder="Search proposed tasks…"
                emptyText="No pending AI proposed tasks."
                disabled={busy}
              />
              <div className="space-y-2 pt-2">
                <Label>Assignees (optional)</Label>
                <SearchableMultiSelect
                  values={assigneeIds}
                  onChange={setAssigneeIds}
                  options={memberOptions}
                  placeholder="Select assignees…"
                  searchPlaceholder="Search members…"
                  emptyText="No ClickUp members cached yet."
                  disabled={busy}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="create-due-date">Due date (optional)</Label>
                  <Input id="create-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox checked={dueDateTime} onCheckedChange={(v) => setDueDateTime(v === true)} disabled={busy || !dueDate} />
                    Include due time
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Executing…" : titleByType[actionType] ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
