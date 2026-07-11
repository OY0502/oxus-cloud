import React, { useEffect, useMemo, useState } from "react";
import { FormDialog, NumberField, SelectField, TextField, TextareaField, fromSelectValue, toSelectValue, Field } from "@/components/forms/FormKit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  useManageTeamMemberRate,
  useAllocateInvoicePayment,
  useProjects,
  useUpsertProjectAssignment,
  useCreateTeamActivity,
  useContractorInvoices,
  useCreateContractorInvoice,
  useUpdateContractorInvoice,
  useUploadContractorInvoiceFile,
  useTeamMemberDeleteDependencies,
  useDeleteTeamMemberPermanently,
  useTeamMemberRates,
  useResolveTeamMemberRate,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { contractorInvoiceOutstanding, isOpenContractorInvoice } from "@/lib/contractorInvoices";
import { formatCurrency } from "@/lib/currency";
import type { Contact, ContractorInvoice, PayoutProvider, TeamMemberRate } from "@/lib/types";
import {
  RateFormFields,
  DEFAULT_RATE_FORM,
  rateFormToInput,
  rateFormValuesFromRate,
  type RateFormValues,
} from "./RateForm";
import { formatRate } from "@/lib/team";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const EMPTY_CONTRACTOR_INVOICES: ContractorInvoice[] = [];

export function RateDialog({
  open,
  onOpenChange,
  person,
  rate,
  mode = "create",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Contact;
  rate?: TeamMemberRate | null;
  mode?: "create" | "edit" | "duplicate" | "replace";
}) {
  const { toast } = useToast();
  const manageRate = useManageTeamMemberRate();
  const { data: projects = [] } = useProjects();
  const [values, setValues] = useState<RateFormValues>(DEFAULT_RATE_FORM);

  useEffect(() => {
    if (!open) return;
    if (rate && (mode === "edit" || mode === "duplicate" || mode === "replace")) {
      const base = rateFormValuesFromRate(rate);
      if (mode === "duplicate") {
        setValues({
          ...base,
          name: `${base.name} (copy)`,
          effectiveFrom: new Date().toISOString().slice(0, 10),
          effectiveTo: "",
        });
      } else if (mode === "replace") {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setValues({
          ...base,
          effectiveFrom: tomorrow.toISOString().slice(0, 10),
          effectiveTo: "",
        });
      } else {
        setValues(base);
      }
    } else {
      setValues({
        ...DEFAULT_RATE_FORM,
        effectiveFrom: new Date().toISOString().slice(0, 10),
      });
    }
  }, [open, rate, mode]);

  const patch = (p: Partial<RateFormValues>) => setValues((v) => ({ ...v, ...p }));

  const title =
    mode === "edit" ? "Edit rate"
      : mode === "duplicate" ? "Duplicate rate"
        : mode === "replace" ? "Schedule replacement"
          : "Add rate";

  const submit = async () => {
    const parsed = parseFloat(values.amount);
    if (!parsed || parsed <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    const input = rateFormToInput(person.id, values);
    try {
      if (mode === "edit" && rate) {
        await manageRate.mutateAsync({
          action: "update",
          person_id: person.id,
          rate_id: rate.id,
          name: input.name,
          description: input.description,
          rate_type: input.rate_type,
          amount: input.amount,
          currency: input.currency,
          project_id: input.project_id,
          work_type: input.work_type,
          is_default: input.is_default,
          effective_from: input.effective_from,
          effective_to: input.effective_to,
          notes: input.notes,
        });
        toast({ title: "Rate updated" });
      } else if (mode === "replace" && rate) {
        await manageRate.mutateAsync({
          action: "replace",
          person_id: person.id,
          rate_id: rate.id,
          effective_from: input.effective_from,
          name: input.name,
          rate_type: input.rate_type,
          amount: input.amount,
          currency: input.currency,
          description: input.description,
          notes: input.notes,
        });
        toast({ title: "Replacement rate scheduled", description: "Previous rate preserved in history." });
      } else {
        await manageRate.mutateAsync({
          action: "create",
          person_id: person.id,
          name: input.name,
          description: input.description,
          rate_type: input.rate_type,
          amount: input.amount,
          currency: input.currency,
          project_id: input.project_id,
          work_type: input.work_type,
          is_default: input.is_default,
          effective_from: input.effective_from,
          effective_to: input.effective_to,
          notes: input.notes,
        });
        toast({ title: "Rate created" });
      }
      onOpenChange(false);
    } catch (e) {
      toast({
        title: `Could not ${mode === "edit" ? "update" : "save"} rate`,
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={`Compensation rate for ${person.name}. Historical rates are never overwritten.`}
      onSubmit={() => void submit()}
      submitting={manageRate.isPending}
      submitLabel={mode === "replace" ? "Schedule replacement" : "Save rate"}
      disabled={!values.amount.trim()}
    >
      <RateFormFields
        values={values}
        onChange={patch}
        projects={projects}
        showEffectiveTo={mode === "edit"}
      />
    </FormDialog>
  );
}

/** @deprecated Use RateDialog — kept for existing imports */
export function ChangeRateDialog({
  open,
  onOpenChange,
  person,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Contact;
}) {
  return (
    <RateDialog
      open={open}
      onOpenChange={onOpenChange}
      person={person}
      mode="create"
    />
  );
}

// Legacy ChangeRateDialog implementation removed — RateDialog handles all cases.

export function ContractorInvoiceDialog({
  open,
  onOpenChange,
  person,
  invoice,
  onAssignProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Contact;
  invoice?: ContractorInvoice | null;
  onAssignProject?: (invoiceId: string, projectId: string | null) => Promise<void>;
}) {
  const { toast } = useToast();
  const createInvoice = useCreateContractorInvoice();
  const updateInvoice = useUpdateContractorInvoice();
  const uploadFile = useUploadContractorInvoiceFile();
  const { data: projects = [] } = useProjects();
  const isEdit = !!invoice;

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [subtotal, setSubtotal] = useState("");
  const [tax, setTax] = useState("");
  const [total, setTotal] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("manual");
  const [status, setStatus] = useState("received");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setInvoiceNumber(invoice.invoice_number ?? "");
      setInvoiceDate(invoice.invoice_date);
      setDueDate(invoice.due_date ?? "");
      setPeriodStart(invoice.period_start ?? "");
      setPeriodEnd(invoice.period_end ?? "");
      setProjectId(invoice.project_id ?? "");
      setCurrency(invoice.currency);
      setSubtotal(String(invoice.subtotal));
      setTax(String(invoice.tax_amount));
      setTotal(String(invoice.total));
      setDescription(invoice.description ?? "");
      setSource(invoice.source);
      setStatus(invoice.status);
    } else {
      setInvoiceNumber("");
      setInvoiceDate(new Date().toISOString().slice(0, 10));
      setDueDate("");
      setPeriodStart("");
      setPeriodEnd("");
      setProjectId("");
      setCurrency("EUR");
      setSubtotal("");
      setTax("0");
      setTotal("");
      setDescription("");
      setSource("manual");
      setStatus("received");
    }
    setFile(null);
  }, [open, invoice]);

  useEffect(() => {
    const sub = parseFloat(subtotal) || 0;
    const taxAmt = parseFloat(tax) || 0;
    if (sub > 0 || taxAmt > 0) setTotal(String(sub + taxAmt));
  }, [subtotal, tax]);

  const submit = async () => {
    const parsedTotal = parseFloat(total);
    if (!parsedTotal || parsedTotal <= 0) {
      toast({ title: "Enter a valid total", variant: "destructive" });
      return;
    }
    if (!invoiceDate) {
      toast({ title: "Invoice date is required", variant: "destructive" });
      return;
    }
    try {
      if (isEdit && invoice) {
        await updateInvoice.mutateAsync({
          id: invoice.id,
          person_id: person.id,
          patch: {
            invoice_number: invoiceNumber || null,
            invoice_date: invoiceDate,
            due_date: dueDate || null,
            period_start: periodStart || null,
            period_end: periodEnd || null,
            project_id: projectId || null,
            currency,
            subtotal: parseFloat(subtotal) || parsedTotal,
            tax_amount: parseFloat(tax) || 0,
            total: parsedTotal,
            description: description || null,
            source: source as ContractorInvoice["source"],
            status: status as ContractorInvoice["status"],
          },
        });
        if (onAssignProject && projectId !== (invoice.project_id ?? "")) {
          await onAssignProject(invoice.id, projectId || null);
        }
        if (file) {
          await uploadFile.mutateAsync({ invoice_id: invoice.id, person_id: person.id, file });
        }
        toast({ title: "Invoice updated" });
      } else {
        const created = await createInvoice.mutateAsync({
          person_id: person.id,
          invoice_number: invoiceNumber || null,
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          period_start: periodStart || null,
          period_end: periodEnd || null,
          project_id: projectId || null,
          currency,
          subtotal: parseFloat(subtotal) || parsedTotal,
          tax_amount: parseFloat(tax) || 0,
          total: parsedTotal,
          description: description || null,
          source,
          status,
        });
        if (file) {
          await uploadFile.mutateAsync({ invoice_id: created.id, person_id: person.id, file });
        }
        toast({ title: "Invoice created" });
      }
      onOpenChange(false);
    } catch (e) {
      toast({
        title: isEdit ? "Could not update invoice" : "Could not create invoice",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Contractor invoice" : "Add contractor invoice"}
      description={`Accounts payable invoice from ${person.name} to OXUS.`}
      onSubmit={() => void submit()}
      submitting={createInvoice.isPending || updateInvoice.isPending}
      submitLabel={isEdit ? "Save invoice" : "Add invoice"}
      disabled={!total.trim()}
    >
      <TextField label="Invoice number" value={invoiceNumber} onChange={setInvoiceNumber} placeholder="INV-2026-001" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Invoice date">
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period start">
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </Field>
        <Field label="Period end">
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </Field>
      </div>
      <SelectField
        label="Project (optional)"
        value={toSelectValue(projectId)}
        onChange={(v) => setProjectId(fromSelectValue(v))}
        options={[
          { value: toSelectValue(""), label: "— None —" },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="Subtotal" value={subtotal} onChange={setSubtotal} />
        <NumberField label="Tax" value={tax} onChange={setTax} />
        <NumberField label="Total" value={total} onChange={setTotal} required />
      </div>
      <SelectField
        label="Currency"
        value={currency}
        onChange={setCurrency}
        options={[
          { value: "EUR", label: "EUR (€)" },
          { value: "USD", label: "USD ($)" },
        ]}
      />
      <TextareaField label="Description" value={description} onChange={setDescription} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            { value: "manual", label: "Manual" },
            { value: "uploaded_file", label: "Uploaded file" },
            { value: "wise", label: "Wise" },
            { value: "email", label: "Email" },
            { value: "other", label: "Other" },
          ]}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "received", label: "Received" },
            { value: "approved", label: "Approved" },
            { value: "partially_paid", label: "Partially paid" },
            { value: "paid", label: "Paid" },
            { value: "disputed", label: "Disputed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>
      <Field label="Attachment (PDF or image, max 10 MB)">
        <Input
          type="file"
          accept=".pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
    </FormDialog>
  );
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  person,
  preselectedInvoiceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Contact;
  preselectedInvoiceId?: string | null;
}) {
  const { toast } = useToast();
  const allocatePayment = useAllocateInvoicePayment();
  const { data: invoicesData } = useContractorInvoices(person.id, { enabled: open });
  const openInvoices = invoicesData ?? EMPTY_CONTRACTOR_INVOICES;
  const { data: projects = [] } = useProjects();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [projectId, setProjectId] = useState("");
  const [provider, setProvider] = useState<PayoutProvider>("manual");
  const [status, setStatus] = useState("paid");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});

  const payableInvoices = useMemo(
    () => openInvoices.filter(isOpenContractorInvoice),
    [openInvoices],
  );

  const payableInvoiceKey = useMemo(
    () => payableInvoices.map((i) => i.id).join(","),
    [payableInvoices],
  );

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setCurrency("EUR");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPeriodStart("");
    setPeriodEnd("");
    setProjectId("");
    setProvider("manual");
    setStatus("paid");
    setNotes("");
    setSelected({});
  }, [open]);

  useEffect(() => {
    if (!open || !preselectedInvoiceId || !payableInvoiceKey) return;
    setSelected((prev) => {
      if (prev[preselectedInvoiceId]) return prev;
      const inv = payableInvoices.find((i) => i.id === preselectedInvoiceId);
      if (!inv) return prev;
      return { [inv.id]: String(contractorInvoiceOutstanding(inv)) };
    });
  }, [open, preselectedInvoiceId, payableInvoiceKey]);

  const allocTotal = Object.entries(selected).reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);
  const paymentAmount = parseFloat(amount) || 0;
  const unallocated = Math.max(0, paymentAmount - allocTotal);

  const toggleInvoice = (invoice: ContractorInvoice, checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[invoice.id] = String(contractorInvoiceOutstanding(invoice));
      else delete next[invoice.id];
      return next;
    });
  };

  const submit = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (allocTotal > parsed + 0.01) {
      toast({ title: "Allocations exceed payment amount", variant: "destructive" });
      return;
    }
    const allocations = Object.entries(selected)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([contractor_invoice_id, v]) => ({
        contractor_invoice_id,
        allocated_amount: parseFloat(v),
      }));
    try {
      await allocatePayment.mutateAsync({
        person_id: person.id,
        amount: parsed,
        currency,
        payment_date: paymentDate,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        project_id: projectId || null,
        provider,
        status,
        notes: notes || null,
        allocations,
      });
      toast({ title: "Payment recorded" });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Could not record payment",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description={`Log an outgoing payment to ${person.name}. Optionally allocate to open contractor invoices.`}
      onSubmit={() => void submit()}
      submitting={allocatePayment.isPending}
      submitLabel="Record payment"
      disabled={!amount.trim()}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Amount" value={amount} onChange={setAmount} required />
        <SelectField
          label="Currency"
          value={currency}
          onChange={setCurrency}
          options={[
            { value: "EUR", label: "EUR (€)" },
            { value: "USD", label: "USD ($)" },
          ]}
        />
      </div>
      <Field label="Payment date">
        <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period start">
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </Field>
        <Field label="Period end">
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </Field>
      </div>
      <SelectField
        label="Project (optional)"
        value={toSelectValue(projectId)}
        onChange={(v) => setProjectId(fromSelectValue(v))}
        options={[
          { value: toSelectValue(""), label: "— None —" },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Provider"
          value={provider}
          onChange={(v) => setProvider(v as PayoutProvider)}
          options={[
            { value: "manual", label: "Manual" },
            { value: "wise", label: "Wise" },
            { value: "bank_transfer", label: "Bank transfer" },
            { value: "stripe", label: "Stripe" },
            { value: "other", label: "Other" },
          ]}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "paid", label: "Paid" },
            { value: "pending", label: "Pending" },
            { value: "processing", label: "Processing" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>

      {payableInvoices.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <Label className="text-sm">Allocate to invoices</Label>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {payableInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={inv.id in selected}
                  onCheckedChange={(c) => toggleInvoice(inv, !!c)}
                />
                <span className="flex-1 min-w-0 truncate">
                  {inv.invoice_number ?? inv.id.slice(0, 8)} · {formatCurrency(contractorInvoiceOutstanding(inv), inv.currency)}
                </span>
                {inv.id in selected && (
                  <Input
                    className="h-8 w-24"
                    type="number"
                    value={selected[inv.id] ?? ""}
                    onChange={(e) => setSelected((p) => ({ ...p, [inv.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          {paymentAmount > 0 && (
            <p className="text-xs text-muted-foreground">
              Allocated: {formatCurrency(allocTotal, currency)} · Unallocated: {formatCurrency(unallocated, currency)}
            </p>
          )}
        </div>
      )}

      <TextareaField label="Notes" value={notes} onChange={setNotes} />
    </FormDialog>
  );
}

export function AssignProjectDialog({
  open,
  onOpenChange,
  person,
  assignment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Contact;
  assignment?: {
    project_id: string;
    role_on_project?: string | null;
    allocation_percent?: number | null;
    weekly_hours?: number | null;
    start_date?: string | null;
    rate_id?: string | null;
  } | null;
}) {
  const { toast } = useToast();
  const upsert = useUpsertProjectAssignment();
  const logActivity = useCreateTeamActivity();
  const { data: projects = [] } = useProjects();
  const { data: rates = [] } = useTeamMemberRates(person.id, { enabled: open });
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState("");
  const [allocation, setAllocation] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [rateMode, setRateMode] = useState<"auto" | "select" | "create">("auto");
  const [selectedRateId, setSelectedRateId] = useState("");

  const resolveQuery = useResolveTeamMemberRate(person.id, {
    enabled: open && !!projectId && rateMode === "auto",
    projectId: projectId || null,
    workType: role || null,
    effectiveDate: startDate,
  });

  useEffect(() => {
    if (!open) return;
    setProjectId(assignment?.project_id ?? "");
    setRole(assignment?.role_on_project ?? "");
    setAllocation(assignment?.allocation_percent != null ? String(assignment.allocation_percent) : "");
    setWeeklyHours(assignment?.weekly_hours != null ? String(assignment.weekly_hours) : "");
    setStartDate(assignment?.start_date ?? new Date().toISOString().slice(0, 10));
    setRateMode(assignment?.rate_id ? "select" : "auto");
    setSelectedRateId(assignment?.rate_id ?? "");
  }, [open, assignment]);

  const applicableRates = rates.filter(
    (r) => r.status === "active" && (!r.project_id || r.project_id === projectId),
  );

  const submit = async () => {
    if (!projectId) {
      toast({ title: "Select a project", variant: "destructive" });
      return;
    }
    if (rateMode === "auto" && resolveQuery.data?.warning) {
      toast({ title: "Rate conflict", description: resolveQuery.data.warning, variant: "destructive" });
      return;
    }
    if (rateMode === "auto" && resolveQuery.data?.match_type === "none") {
      toast({ title: "No matching rate", description: "Create a rate or select one explicitly.", variant: "destructive" });
      return;
    }
    try {
      let rateId: string | null = null;
      let snapshotAmount: number | null = null;
      let snapshotCurrency: string | null = null;

      if (rateMode === "select" && selectedRateId) {
        const selected = rates.find((r) => r.id === selectedRateId);
        rateId = selectedRateId;
        snapshotAmount = selected?.amount ?? null;
        snapshotCurrency = selected?.currency ?? null;
      } else if (rateMode === "auto" && resolveQuery.data?.rate) {
        rateId = resolveQuery.data.rate.id;
        snapshotAmount = resolveQuery.data.rate.amount;
        snapshotCurrency = resolveQuery.data.rate.currency;
      }

      await upsert.mutateAsync({
        project_id: projectId,
        contact_id: person.id,
        role_on_project: role || null,
        allocation_percent: allocation ? parseFloat(allocation) : null,
        weekly_hours: weeklyHours ? parseFloat(weeklyHours) : null,
        start_date: startDate || null,
        is_active: true,
        rate_id: rateId,
        rate_snapshot_amount: snapshotAmount,
        rate_snapshot_currency: snapshotCurrency,
      });
      const projectName = projects.find((p) => p.id === projectId)?.name ?? "project";
      await logActivity.mutateAsync({
        contact_id: person.id,
        title: assignment ? "Project assignment updated" : "Assigned to project",
        description: projectName,
      });
      toast({ title: assignment ? "Assignment updated" : "Project assigned" });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Could not save assignment",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={assignment ? "Edit project assignment" : "Assign project"}
      description={`Link ${person.name} to a project with allocation details.`}
      onSubmit={() => void submit()}
      submitting={upsert.isPending}
      submitLabel="Save assignment"
      disabled={!projectId}
    >
      <SelectField
        label="Project"
        value={toSelectValue(projectId)}
        onChange={(v) => setProjectId(fromSelectValue(v))}
        options={[
          { value: toSelectValue(""), label: "Select project…" },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      <TextField label="Role on project" value={role} onChange={setRole} placeholder="Tech lead, Developer…" />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Allocation %" value={allocation} onChange={setAllocation} placeholder="50" />
        <NumberField label="Weekly hours" value={weeklyHours} onChange={setWeeklyHours} placeholder="20" />
      </div>
      <Field label="Start date">
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </Field>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <Label className="text-sm font-medium">Billing rate</Label>
        <SelectField
          label="Rate selection"
          value={rateMode}
          onChange={(v) => setRateMode(v as "auto" | "select")}
          options={[
            { value: "auto", label: "Use automatically resolved rate" },
            { value: "select", label: "Select an existing rate" },
          ]}
        />
        {rateMode === "auto" && projectId && (
          <div className="text-sm space-y-1">
            {resolveQuery.isLoading ? (
              <p className="text-muted-foreground">Resolving rate…</p>
            ) : resolveQuery.data?.rate ? (
              <p className="text-muted-foreground">
                Will apply: <span className="font-medium text-foreground">{formatRate(resolveQuery.data.rate)}</span>
                {" · "}{resolveQuery.data.match_type.replace(/_/g, " ")}
              </p>
            ) : resolveQuery.data?.warning ? (
              <Alert variant="destructive" className="py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{resolveQuery.data.warning}</AlertDescription>
              </Alert>
            ) : (
              <p className="text-amber-600">No matching rate found for this project.</p>
            )}
          </div>
        )}
        {rateMode === "select" && (
          <SelectField
            label="Rate"
            value={toSelectValue(selectedRateId)}
            onChange={(v) => setSelectedRateId(fromSelectValue(v))}
            options={[
              { value: toSelectValue(""), label: "Select rate…" },
              ...applicableRates.map((r) => ({
                value: r.id,
                label: `${r.name ?? r.rate_type} · ${formatRate(r)}`,
              })),
            ]}
          />
        )}
      </div>
    </FormDialog>
  );
}

function deleteConfirmationPhrase(name: string): string {
  return `DELETE ${name.trim()}`;
}

export function DeleteTeamMemberDialog({
  open,
  onOpenChange,
  person,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: Contact;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const depsQuery = useTeamMemberDeleteDependencies(person.id, { enabled: open });
  const deleteMember = useDeleteTeamMemberPermanently();
  const [confirmation, setConfirmation] = useState("");
  const [deleteAuthUser, setDeleteAuthUser] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmation("");
      setDeleteAuthUser(false);
    }
  }, [open, person.id]);

  const expected = deleteConfirmationPhrase(person.name);
  const deps = depsQuery.data;
  const canDelete = deps?.can_delete ?? false;
  const hasAuth = deps?.summary.has_workspace_access ?? false;
  const confirmationOk = confirmation.trim() === expected;

  const submit = async () => {
    if (!confirmationOk || !canDelete) return;
    try {
      const result = await deleteMember.mutateAsync({
        person_id: person.id,
        confirmation_text: confirmation.trim(),
        delete_auth_user: deleteAuthUser && hasAuth,
      });
      toast({
        title: "Member permanently deleted",
        description: result.auth_user_deleted
          ? `${person.name} and their login were removed.`
          : `${person.name} was removed from the team roster.`,
      });
      onDeleted();
    } catch (e) {
      toast({
        title: "Could not delete member",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete permanently</DialogTitle>
          <DialogDescription>
            This removes the person record and team link. It is intended for test users, duplicates, and records that should never have existed — not normal offboarding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <div className="font-medium">{person.name}</div>
            <div className="text-muted-foreground">{person.email ?? "No email"}</div>
            <div className="text-muted-foreground">
              {deps?.person.engagement ?? "—"}
              {hasAuth ? " · Has workspace login" : " · No workspace login"}
            </div>
          </div>

          {depsQuery.isLoading ? (
            <p className="text-muted-foreground">Checking linked records…</p>
          ) : depsQuery.isError ? (
            <p className="text-destructive">Could not load dependency summary.</p>
          ) : deps ? (
            <>
              {!canDelete && deps.blockers.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <p className="font-medium text-destructive">Deletion blocked</p>
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                    {deps.blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                  <p className="text-muted-foreground">Deactivate this member instead to remove them from the active roster without losing history.</p>
                </div>
              )}

              {canDelete && (
                <div className="space-y-2">
                  <p className="font-medium">Will be deleted</p>
                  <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                    {deps.will_delete.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}

              {deps.will_preserve.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Will be preserved</p>
                  <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                    {deps.will_preserve.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}

              {hasAuth && canDelete && (
                <div className="flex items-start gap-2 rounded-lg border border-border/60 p-3">
                  <Checkbox
                    id="delete-auth-user"
                    checked={deleteAuthUser}
                    onCheckedChange={(v) => setDeleteAuthUser(v === true)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="delete-auth-user" className="font-medium leading-none">
                      Also delete this user&apos;s OXUS Cloud login
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Removes their ability to sign in. This uses the server-side admin API and cannot be undone.
                    </p>
                  </div>
                </div>
              )}

              {canDelete && (
                <div className="space-y-2">
                  <Label htmlFor="delete-confirmation">
                    Type <span className="font-mono text-xs">{expected}</span> to confirm
                  </Label>
                  <Input
                    id="delete-confirmation"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder={expected}
                    autoComplete="off"
                  />
                </div>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canDelete || !confirmationOk || deleteMember.isPending || depsQuery.isLoading}
            onClick={() => void submit()}
          >
            {deleteMember.isPending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
