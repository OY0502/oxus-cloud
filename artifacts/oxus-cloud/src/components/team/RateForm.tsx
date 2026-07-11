import React, { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumberField, SelectField, TextField, TextareaField, Field, fromSelectValue, toSelectValue } from "@/components/forms/FormKit";
import {
  WORK_TYPES,
  SUPPORTED_CURRENCIES,
  formatRateDescription,
  formatRatePreview,
  scopeFromForm,
} from "@/lib/teamMemberRates";
import type { Project, RateType, TeamMemberRateInput } from "@/lib/types";

export type RateAppliesTo = "default" | "project" | "work_type" | "project_work_type";

export interface RateFormValues {
  name: string;
  description: string;
  rateType: RateType;
  amount: string;
  currency: string;
  appliesTo: RateAppliesTo;
  projectId: string;
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
  projectId: "",
  workType: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  notes: "",
};

export function rateFormToInput(
  personId: string,
  values: RateFormValues,
): TeamMemberRateInput {
  const scope = scopeFromForm(values.appliesTo, values.projectId, values.workType);
  return {
    person_id: personId,
    name: values.name.trim() || "Rate",
    description: values.description.trim() || null,
    rate_type: values.rateType,
    amount: parseFloat(values.amount),
    currency: values.currency,
    project_id: scope.project_id,
    work_type: scope.work_type,
    is_default: scope.is_default,
    effective_from: values.effectiveFrom,
    effective_to: values.effectiveTo || null,
    notes: values.notes.trim() || null,
  };
}

export function RateFormFields({
  values,
  onChange,
  projects = [],
  projectName,
  showEffectiveTo = false,
}: {
  values: RateFormValues;
  onChange: (patch: Partial<RateFormValues>) => void;
  projects?: Pick<Project, "id" | "name">[];
  projectName?: string | null;
  showEffectiveTo?: boolean;
}) {
  const preview = useMemo(() => {
    const amount = parseFloat(values.amount);
    if (!amount || amount <= 0) return null;
    const scope = scopeFromForm(values.appliesTo, values.projectId, values.workType);
    const projectLabel = projects.find((p) => p.id === values.projectId)?.name ?? projectName;
    let scopeText = "Default";
    if (scope.project_id && scope.work_type) scopeText = `${projectLabel ?? "Project"} · ${scope.work_type}`;
    else if (scope.project_id) scopeText = projectLabel ?? "Project";
    else if (scope.work_type) scopeText = scope.work_type;

    const ratePreview = formatRatePreview({
      amount,
      currency: values.currency,
      rate_type: values.rateType,
    });
    const parts = [ratePreview];
    if (scopeText !== "Default") parts.push(`for ${scopeText}`);
    if (values.effectiveFrom) parts.push(`effective from ${values.effectiveFrom}`);
    return parts.join(" · ");
  }, [values, projects, projectName]);

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
          onChange={(v) => onChange({ appliesTo: v as RateAppliesTo })}
          options={[
            { value: "default", label: "Default" },
            { value: "project", label: "Specific project" },
            { value: "work_type", label: "Specific work type" },
            { value: "project_work_type", label: "Project and work type" },
          ]}
        />
        {(values.appliesTo === "project" || values.appliesTo === "project_work_type") && (
          <SelectField
            label="Project"
            value={toSelectValue(values.projectId)}
            onChange={(v) => onChange({ projectId: fromSelectValue(v) })}
            options={[
              { value: toSelectValue(""), label: "Select project…" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
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
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {preview}
        </div>
      )}
    </div>
  );
}

export function rateFormValuesFromRate(rate: {
  name?: string | null;
  description?: string | null;
  rate_type: RateType;
  amount: number;
  currency: string;
  project_id?: string | null;
  work_type?: string | null;
  is_default?: boolean;
  effective_from: string;
  effective_to?: string | null;
  notes?: string | null;
}): RateFormValues {
  let appliesTo: RateAppliesTo = "default";
  if (rate.project_id && rate.work_type) appliesTo = "project_work_type";
  else if (rate.project_id) appliesTo = "project";
  else if (rate.work_type) appliesTo = "work_type";

  return {
    name: rate.name ?? "",
    description: rate.description ?? "",
    rateType: rate.rate_type,
    amount: String(rate.amount),
    currency: rate.currency ?? "EUR",
    appliesTo,
    projectId: rate.project_id ?? "",
    workType: rate.work_type ?? "",
    effectiveFrom: rate.effective_from,
    effectiveTo: rate.effective_to ?? "",
    notes: rate.notes ?? "",
  };
}
