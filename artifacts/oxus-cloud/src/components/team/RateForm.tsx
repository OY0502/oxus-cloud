import React, { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumberField, SelectField, TextField, TextareaField, Field, fromSelectValue, toSelectValue } from "@/components/forms/FormKit";
import { SearchableMultiSelect } from "@/components/forms/SearchableMultiSelect";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  WORK_TYPES,
  SUPPORTED_CURRENCIES,
  formatRatePreview,
  formatProjectScopePreview,
  scopeFromForm,
  rateProjectIds,
} from "@/lib/teamMemberRates";
import type { Project, RateType, TeamMemberRate, TeamMemberRateInput } from "@/lib/types";

export type RateAppliesTo = "default" | "project" | "work_type" | "project_work_type";

export interface RateFormValues {
  name: string;
  description: string;
  rateType: RateType;
  amount: string;
  currency: string;
  appliesTo: RateAppliesTo;
  projectIds: string[];
  workType: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
}

export const DEFAULT_RATE_FORM: RateFormValues = {
  name: "",
  description: "",
  rateType: "hourly",
  amount: "",
  currency: "EUR",
  appliesTo: "default",
  projectIds: [],
  workType: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  notes: "",
};

export function rateFormToInput(
  personId: string,
  values: RateFormValues,
): TeamMemberRateInput {
  const scope = scopeFromForm(values.appliesTo, values.projectIds, values.workType);
  return {
    person_id: personId,
    name: values.name.trim() || "Rate",
    description: values.description.trim() || null,
    rate_type: values.rateType,
    amount: parseFloat(values.amount),
    currency: values.currency,
    project_ids: scope.project_ids,
    work_type: scope.work_type,
    is_default: scope.is_default,
    effective_from: values.effectiveFrom,
    effective_to: values.effectiveTo || null,
    notes: values.notes.trim() || null,
  };
}

export function rateFormRequiresProjects(appliesTo: RateAppliesTo): boolean {
  return appliesTo === "project" || appliesTo === "project_work_type";
}

export function RateFormFields({
  values,
  onChange,
  projects = [],
  showEffectiveTo = false,
  projectError,
}: {
  values: RateFormValues;
  onChange: (patch: Partial<RateFormValues>) => void;
  projects?: Pick<Project, "id" | "name" | "archived_at">[];
  showEffectiveTo?: boolean;
  projectError?: string | null;
}) {
  const selectedProjects = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    return values.projectIds.flatMap((id) => {
      const p = byId.get(id);
      return p ? [{ id: p.id, name: p.name }] : [];
    });
  }, [values.projectIds, projects]);

  const selectableProjects = useMemo(() => {
    const active = projects.filter((p) => !p.archived_at);
    const archivedSelected = projects.filter(
      (p) => p.archived_at && values.projectIds.includes(p.id),
    );
    return [...active, ...archivedSelected];
  }, [projects, values.projectIds]);

  const preview = useMemo(() => {
    const amount = parseFloat(values.amount);
    if (!amount || amount <= 0) return null;

    const ratePreview = formatRatePreview({
      amount,
      currency: values.currency,
      rate_type: values.rateType,
    });

    if (values.appliesTo === "default") {
      return `${ratePreview}\nEffective from ${values.effectiveFrom}`;
    }

    if (values.appliesTo === "work_type") {
      return `${ratePreview} for ${values.workType || "work type"}\nEffective from ${values.effectiveFrom}`;
    }

    const projectText = formatProjectScopePreview(selectedProjects);
    if (values.appliesTo === "project_work_type") {
      return `${ratePreview} for ${values.workType || "work type"} on ${projectText}\nEffective from ${values.effectiveFrom}`;
    }

    return `${ratePreview} for ${projectText || "selected projects"}\nEffective from ${values.effectiveFrom}`;
  }, [values, selectedProjects]);

  const handleScopeChange = (appliesTo: RateAppliesTo) => {
    const leavingProjectScope = rateFormRequiresProjects(values.appliesTo) && !rateFormRequiresProjects(appliesTo);
    if (leavingProjectScope && values.projectIds.length > 0) {
      const confirmed = window.confirm(
        "Changing scope will remove the selected projects from this rate. Continue?",
      );
      if (!confirmed) return;
      onChange({ appliesTo, projectIds: [] });
      return;
    }
    onChange({ appliesTo, ...(rateFormRequiresProjects(appliesTo) ? {} : { projectIds: [] }) });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <h4 className="text-sm font-medium">Rate details</h4>
        <TextField
          label="Name"
          value={values.name}
          onChange={(v) => onChange({ name: v })}
          placeholder="e.g. Carrotz development"
        />
        <SelectField
          label="Type"
          value={values.rateType}
          onChange={(v) => onChange({ rateType: v as RateType })}
          options={[
            { value: "hourly", label: "Hourly" },
            { value: "daily", label: "Daily" },
            { value: "monthly", label: "Monthly" },
            { value: "fixed_project", label: "Fixed project" },
          ]}
        />
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <NumberField
            label="Amount"
            value={values.amount}
            onChange={(v) => onChange({ amount: v })}
            required
          />
          <div className="space-y-1">
            <Label>Currency</Label>
            <Select value={values.currency} onValueChange={(v) => onChange({ currency: v })}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {values.amount && parseFloat(values.amount) > 0
            ? formatRatePreview({ amount: parseFloat(values.amount), currency: values.currency, rate_type: values.rateType })
            : "Enter amount to see preview"}
        </p>
      </div>

      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <h4 className="text-sm font-medium">Applies to</h4>
        <SelectField
          label="Scope"
          value={values.appliesTo}
          onChange={(v) => handleScopeChange(v as RateAppliesTo)}
          options={[
            { value: "default", label: "Default" },
            { value: "project", label: "Specific project" },
            { value: "work_type", label: "Specific work type" },
            { value: "project_work_type", label: "Project and work type" },
          ]}
        />
        {rateFormRequiresProjects(values.appliesTo) && (
          <div className="space-y-1.5">
            <Label>Projects</Label>
            <SearchableMultiSelect
              values={values.projectIds}
              onChange={(projectIds) => onChange({ projectIds })}
              options={selectableProjects.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Select more projects…"
              searchPlaceholder="Search projects…"
              emptyText="No projects found."
              showClearAll
            />
            <p className="text-xs text-muted-foreground">
              Select one or more projects this rate applies to.
            </p>
            {projectError && (
              <p className="text-xs text-destructive">{projectError}</p>
            )}
          </div>
        )}
        {(values.appliesTo === "work_type" || values.appliesTo === "project_work_type") && (
          <SelectField
            label="Work type"
            value={toSelectValue(values.workType)}
            onChange={(v) => onChange({ workType: fromSelectValue(v) })}
            options={[
              { value: toSelectValue(""), label: "Select work type…" },
              ...WORK_TYPES.map((w) => ({ value: w, label: w })),
            ]}
          />
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <h4 className="text-sm font-medium">Validity</h4>
        <Field label="Effective from">
          <Input
            type="date"
            value={values.effectiveFrom}
            onChange={(e) => onChange({ effectiveFrom: e.target.value })}
          />
        </Field>
        {showEffectiveTo && (
          <Field label="Effective to (optional)">
            <Input
              type="date"
              value={values.effectiveTo}
              onChange={(e) => onChange({ effectiveTo: e.target.value })}
            />
          </Field>
        )}
      </div>

      <TextareaField
        label="Notes"
        value={values.notes}
        onChange={(v) => onChange({ notes: v })}
        placeholder="Optional context for this rate"
      />

      {preview && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-line cursor-default">
                {preview}
              </div>
            </TooltipTrigger>
            {selectedProjects.length > 2 && (
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-sm">{selectedProjects.map((p) => p.name).join(", ")}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

export function rateFormValuesFromRate(rate: TeamMemberRate): RateFormValues {
  const projectIds = rateProjectIds(rate);
  let appliesTo: RateAppliesTo = "default";
  if (projectIds.length && rate.work_type) appliesTo = "project_work_type";
  else if (projectIds.length) appliesTo = "project";
  else if (rate.work_type) appliesTo = "work_type";

  return {
    name: rate.name ?? "",
    description: rate.description ?? "",
    rateType: rate.rate_type,
    amount: String(rate.amount),
    currency: rate.currency ?? "EUR",
    appliesTo,
    projectIds,
    workType: rate.work_type ?? "",
    effectiveFrom: rate.effective_from,
    effectiveTo: rate.effective_to ?? "",
    notes: rate.notes ?? "",
  };
}

export function validateRateFormValues(values: RateFormValues): string | null {
  if (rateFormRequiresProjects(values.appliesTo) && values.projectIds.length === 0) {
    return "Select at least one project for this rate.";
  }
  return null;
}
