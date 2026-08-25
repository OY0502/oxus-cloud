import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import type { AiProposedTask } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: AiProposedTask | null;
  projectId: string;
  onConfirm: (input: ReturnType<typeof clickupTaskFormToPayload>) => Promise<void>;
  busy?: boolean;
  onRequestSetupUpdate?: () => void;
};

const emptyValues = (): ClickupTaskFormValues => ({
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

export function CreateClickupTaskDialog({
  open,
  onOpenChange,
  task,
  projectId,
  onConfirm,
  busy,
  onRequestSetupUpdate,
}: Props) {
  const [values, setValues] = useState<ClickupTaskFormValues>(emptyValues());

  useEffect(() => {
    if (!open || !task) return;
    const estimate =
      typeof task.estimate_hours === "number" && task.estimate_hours > 0
        ? `${Math.round(task.estimate_hours * 60)}m`
        : "";
    setValues({
      title: task.title ?? "",
      description: task.description ?? "",
      priority: task.priority ?? "medium",
      status: "",
      assigneeIds: task.selected_clickup_assignee_ids ?? [],
      startDate: "",
      dueDate: task.selected_due_date ?? "",
      estimateInput: estimate,
      tagNames: [],
    });
  }, [open, task]);

  const confirm = async () => {
    const payload = clickupTaskFormToPayload(values);
    if (payload.error || !payload.title) return;
    await onConfirm(payload);
  };

  if (!task) return null;

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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !values.title.trim() || !!payload.error}>
            {busy ? "Creating…" : "Create Task in ClickUp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
