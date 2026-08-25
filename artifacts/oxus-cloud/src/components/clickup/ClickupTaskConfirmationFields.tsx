import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { SearchableMultiSelect } from "@/components/forms/SearchableMultiSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import type { ClickupListStatusesResult } from "@/hooks/api";
import type { AiProposedTaskPriority } from "@/lib/types";
import { millisecondsToEstimatePreview, parseTimeEstimateInput, validateTaskDateRange } from "@/lib/clickup/taskFields";

/** Sentinel for Radix Select — empty string is reserved for clearing selection. */
const PRIORITY_NONE = "__none__";

export type ClickupTaskFormValues = {
  title: string;
  description: string;
  priority: AiProposedTaskPriority | "";
  status: string;
  assigneeIds: string[];
  startDate: string;
  dueDate: string;
  estimateInput: string;
  tagNames: string[];
};

type Props = {
  projectId: string;
  open: boolean;
  values: ClickupTaskFormValues;
  onChange: (values: ClickupTaskFormValues) => void;
  busy?: boolean;
  onRequestSetupUpdate?: () => void;
};

function capabilityWarning(
  setup: ClickupListStatusesResult["setup"],
  capabilities: ClickupListStatusesResult["capabilities"],
  key: keyof NonNullable<ClickupListStatusesResult["capabilities"]>,
): string | null {
  if (!setup || !capabilities) return null;
  const cap = capabilities[key];
  if (!cap || ("available" in cap && cap.available)) return null;
  if ("manual_step" in cap && typeof cap.manual_step === "string") return cap.manual_step;
  return `${key.replace("_", " ")} is not available in the connected ClickUp Space.`;
}

export function ClickupTaskConfirmationFields({
  projectId,
  open,
  values,
  onChange,
  busy,
  onRequestSetupUpdate,
}: Props) {
  const { data: members = [], isLoading: membersLoading } = useClickupAssignableMembers(projectId);
  const syncMembers = useSyncClickupMembers();
  const statusesQuery = useClickupListStatuses(projectId, open);
  const [estimatePreview, setEstimatePreview] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);

  const statusData = statusesQuery.data;
  const statusOptions = statusData?.statuses ?? [];
  const defaultStatus = statusData?.default_status ?? null;
  const notLinked = statusData ? statusData.linked === false : false;
  const tagOptions = statusData?.tags ?? [];

  useEffect(() => {
    if (!open) return;
    if (!values.status && defaultStatus) {
      onChange({ ...values, status: defaultStatus });
    }
  }, [open, defaultStatus, values.status]);

  useEffect(() => {
    if (open && projectId && members.length === 0 && !membersLoading && !syncMembers.isPending) {
      syncMembers.mutate({ project_id: projectId });
    }
  }, [open, projectId, members.length, membersLoading, syncMembers]);

  useEffect(() => {
    const parsed = parseTimeEstimateInput(values.estimateInput);
    setEstimatePreview(parsed.preview ?? "");
  }, [values.estimateInput]);

  useEffect(() => {
    setDateError(validateTaskDateRange(values.startDate, values.dueDate));
  }, [values.startDate, values.dueDate]);

  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.clickup_user_id,
        label: member.name ?? member.email ?? member.clickup_user_id,
        sublabel: member.email ?? undefined,
      })),
    [members],
  );

  const tagSelectOptions = useMemo(
    () => tagOptions.map((tag) => ({ value: tag, label: tag })),
    [tagOptions],
  );

  const patch = (partial: Partial<ClickupTaskFormValues>) => onChange({ ...values, ...partial });

  const warnings = [
    capabilityWarning(statusData?.setup ?? null, statusData?.capabilities ?? null, "start_date"),
    capabilityWarning(statusData?.setup ?? null, statusData?.capabilities ?? null, "due_date"),
    capabilityWarning(statusData?.setup ?? null, statusData?.capabilities ?? null, "time_estimate"),
    capabilityWarning(statusData?.setup ?? null, statusData?.capabilities ?? null, "tags"),
  ].filter((w): w is string => !!w);

  return (
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

      {warnings.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs space-y-2">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {onRequestSetupUpdate && (
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={onRequestSetupUpdate}>
                Update ClickUp setup
              </Button>
            )}
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
        <Label htmlFor="clickup-task-title">Task title</Label>
        <Input
          id="clickup-task-title"
          value={values.title}
          onChange={(e) => patch({ title: e.target.value })}
          disabled={busy}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="clickup-task-description">Description</Label>
        <Textarea
          id="clickup-task-description"
          value={values.description}
          onChange={(e) => patch({ description: e.target.value })}
          rows={6}
          disabled={busy}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Priority</Label>
          <Select
            value={values.priority || PRIORITY_NONE}
            onValueChange={(v) =>
              patch({ priority: v === PRIORITY_NONE ? "" : (v as AiProposedTaskPriority) })
            }
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue placeholder="No priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PRIORITY_NONE}>No priority</SelectItem>
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
            value={values.status || undefined}
            onValueChange={(v) => patch({ status: v })}
            disabled={busy || statusesQuery.isFetching || statusOptions.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={statusesQuery.isFetching ? "Loading from ClickUp…" : "List default"} />
            </SelectTrigger>
            <SelectContent>
              {statusOptions
                .filter((s) => !!s.status)
                .map((s) => (
                  <SelectItem key={s.status} value={s.status}>
                    {s.status}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
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
          values={values.assigneeIds}
          onChange={(assigneeIds) => patch({ assigneeIds })}
          options={memberOptions}
          placeholder={membersLoading || syncMembers.isPending ? "Loading members…" : "Select ClickUp assignees…"}
          searchPlaceholder="Search members…"
          emptyText="No assignable ClickUp members found for this project Space/List."
          disabled={membersLoading || syncMembers.isPending || busy}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="clickup-start-date">Start date</Label>
          <Input
            id="clickup-start-date"
            type="date"
            value={values.startDate}
            onChange={(e) => patch({ startDate: e.target.value })}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clickup-due-date">Due date</Label>
          <Input
            id="clickup-due-date"
            type="date"
            value={values.dueDate}
            onChange={(e) => patch({ dueDate: e.target.value })}
            disabled={busy}
          />
        </div>
      </div>
      {dateError && <p className="text-xs text-destructive">{dateError}</p>}

      <div className="space-y-2">
        <Label htmlFor="clickup-estimate">Time estimate</Label>
        <Input
          id="clickup-estimate"
          value={values.estimateInput}
          onChange={(e) => patch({ estimateInput: e.target.value })}
          placeholder="e.g. 4h, 30m, 3h 30m, 1d"
          disabled={busy}
        />
        {estimatePreview && (
          <p className="text-xs text-muted-foreground">Preview: {estimatePreview || millisecondsToEstimatePreview(0)}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <SearchableMultiSelect
          values={values.tagNames}
          onChange={(tagNames) => patch({ tagNames })}
          options={tagSelectOptions}
          placeholder={tagOptions.length === 0 ? "No tags in ClickUp Space yet" : "Select tags…"}
          searchPlaceholder="Search tags…"
          emptyText="No matching tags in this ClickUp Space."
          disabled={busy || tagOptions.length === 0}
        />
      </div>
    </div>
  );
}

export function clickupTaskFormToPayload(values: ClickupTaskFormValues): {
  title: string;
  description?: string;
  priority?: AiProposedTaskPriority;
  status?: string;
  assignee_ids: string[];
  start_date?: string;
  due_date?: string;
  time_estimate_minutes?: number;
  tag_names?: string[];
  error?: string;
} {
  const dateError = validateTaskDateRange(values.startDate, values.dueDate);
  if (dateError) return { title: values.title, assignee_ids: values.assigneeIds, error: dateError };

  const parsed = parseTimeEstimateInput(values.estimateInput);
  if (parsed.error) return { title: values.title, assignee_ids: values.assigneeIds, error: parsed.error };

  const minutes = parsed.milliseconds ? Math.round(parsed.milliseconds / 60000) : undefined;

  return {
    title: values.title.trim(),
    description: values.description.trim() || undefined,
    priority: values.priority || undefined,
    status: values.status || undefined,
    assignee_ids: values.assigneeIds,
    start_date: values.startDate || undefined,
    due_date: values.dueDate || undefined,
    time_estimate_minutes: minutes,
    tag_names: values.tagNames.length > 0 ? values.tagNames : undefined,
  };
}
