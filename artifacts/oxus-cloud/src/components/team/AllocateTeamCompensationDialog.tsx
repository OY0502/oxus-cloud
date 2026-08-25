import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBulkCreateTeamMemberPayables, useProjects, useResolveTeamMemberRate, useTeamRoster } from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { formatEUR, formatCurrency } from "@/lib/currency";
import { invoiceTotalEur } from "@/lib/invoiceEur";
import type { Invoice } from "@/lib/invoices";
import type { TeamMemberPayableReleaseCondition } from "@/lib/types";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { fromSelectValue, toSelectValue } from "@/components/forms/FormKit";

type CompRow = {
  key: string;
  person_id: string;
  project_id: string;
  work_type: string;
  calculation_basis: "manual" | "hours_x_rate" | "days_x_rate" | "percentage_of_client_invoice";
  quantity: string;
  percentage: string;
  amount: string;
  currency: string;
  release_condition: TeamMemberPayableReleaseCondition;
  due_date: string;
  notes: string;
  source_rate_id: string | null;
  unit_amount: number | null;
};

function emptyRow(invoice: Invoice): CompRow {
  return {
    key: crypto.randomUUID(),
    person_id: "",
    project_id: invoice.projectId ?? "",
    work_type: "",
    calculation_basis: "manual",
    quantity: "",
    percentage: "",
    amount: "",
    currency: invoice.currency ?? "EUR",
    release_condition: "when_client_invoice_paid",
    due_date: "",
    notes: "",
    source_rate_id: null,
    unit_amount: null,
  };
}

interface AllocateTeamCompensationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice;
}

export function AllocateTeamCompensationDialog({
  open,
  onOpenChange,
  invoice,
}: AllocateTeamCompensationDialogProps) {
  const { toast } = useToast();
  const bulkCreate = useBulkCreateTeamMemberPayables();
  const rosterQuery = useTeamRoster({ enabled: open });
  const { data: projects = [] } = useProjects({ enabled: open });
  const [rows, setRows] = useState<CompRow[]>([emptyRow(invoice)]);
  const [confirmOverrun, setConfirmOverrun] = useState(false);

  const teamMembers = useMemo(
    () => (rosterQuery.data ?? []).map((r) => r.person).sort((a, b) => a.name.localeCompare(b.name)),
    [rosterQuery.data],
  );

  useEffect(() => {
    if (open) setRows([emptyRow(invoice)]);
  }, [open, invoice.id]);

  const revenueEur = invoiceTotalEur(invoice);

  const marginPreview = useMemo(() => {
    let allocatedEur = 0;
    let excluded = 0;
    for (const row of rows) {
      const amt = parseFloat(row.amount);
      if (!amt || amt <= 0) continue;
      if (row.currency === "EUR") {
        allocatedEur += amt;
      } else if (row.currency === invoice.currency && invoice.currency === "EUR") {
        allocatedEur += amt;
      } else {
        excluded += 1;
      }
    }
    const margin = revenueEur != null ? revenueEur - allocatedEur : null;
    const marginPct = revenueEur != null && revenueEur > 0 && margin != null
      ? Math.round((margin / revenueEur) * 10000) / 100
      : null;
    return { allocatedEur, margin, marginPct, excluded };
  }, [rows, revenueEur, invoice.currency]);

  const exceedsInvoice = revenueEur != null && marginPreview.allocatedEur > revenueEur;

  const patchRow = (key: string, patch: Partial<CompRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const submit = async (force = false) => {
    if (!force && exceedsInvoice) {
      setConfirmOverrun(true);
      return;
    }
    const validRows = rows.filter((r) => r.person_id && parseFloat(r.amount) > 0);
    if (validRows.length === 0) {
      toast({ title: "Add at least one compensation row", variant: "destructive" });
      return;
    }
    try {
      await bulkCreate.mutateAsync({
        client_invoice_id: invoice.id,
        auto_approve: true,
        rows: validRows.map((r) => ({
          person_id: r.person_id,
          project_id: r.project_id || invoice.projectId || null,
          client_invoice_id: invoice.id,
          title: invoice.client ? `${invoice.client} compensation` : "Client invoice compensation",
          work_type: r.work_type || null,
          calculation_basis: r.calculation_basis,
          source_rate_id: r.source_rate_id,
          quantity: r.quantity ? parseFloat(r.quantity) : null,
          unit_amount: r.unit_amount,
          unit_currency: r.currency,
          percentage: r.percentage ? parseFloat(r.percentage) : null,
          currency: r.currency,
          amount: parseFloat(r.amount),
          period_start: invoice.issueDate,
          period_end: invoice.dueDate ?? invoice.issueDate,
          due_date: r.due_date || null,
          release_condition: r.release_condition,
          notes: r.notes || null,
        })),
      });
      toast({ title: "Team compensation allocated" });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Could not save compensation",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Allocate team compensation</DialogTitle>
            <DialogDescription>
              Record amounts owed to team members for {invoice.client ?? invoice.number}.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/30 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Client invoice revenue</p>
              <p className="font-semibold tabular-nums">{revenueEur != null ? formatEUR(revenueEur) : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Team compensation</p>
              <p className="font-semibold tabular-nums">{formatEUR(marginPreview.allocatedEur)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Expected gross margin</p>
              <p className="font-semibold tabular-nums">
                {marginPreview.margin != null ? formatEUR(marginPreview.margin) : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Expected margin</p>
              <p className="font-semibold tabular-nums">
                {marginPreview.marginPct != null ? `${marginPreview.marginPct}%` : "—"}
              </p>
            </div>
          </div>

          {marginPreview.excluded > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {marginPreview.excluded} row(s) in non-EUR currencies are excluded from the EUR preview. Native amounts are preserved on save.
              </AlertDescription>
            </Alert>
          )}

          {exceedsInvoice && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Total compensation exceeds client invoice revenue. You can still save after confirming.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            {rows.map((row) => (
              <CompensationRowEditor
                key={row.key}
                row={row}
                invoice={invoice}
                teamMembers={teamMembers}
                projects={projects}
                onChange={(patch) => patchRow(row.key, patch)}
                onRemove={rows.length > 1 ? () => setRows((prev) => prev.filter((r) => r.key !== row.key)) : undefined}
              />
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, emptyRow(invoice)])}>
            <Plus className="h-4 w-4 mr-2" /> Add team member
          </Button>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={bulkCreate.isPending}>
              Save compensation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOverrun} onOpenChange={setConfirmOverrun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Compensation exceeds invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Team compensation ({formatEUR(marginPreview.allocatedEur)}) exceeds client revenue ({revenueEur != null ? formatEUR(revenueEur) : "unknown"}). Save anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOverrun(false); void submit(true); }}>
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CompensationRowEditor({
  row,
  invoice,
  teamMembers,
  projects,
  onChange,
  onRemove,
}: {
  row: CompRow;
  invoice: Invoice;
  teamMembers: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<CompRow>) => void;
  onRemove?: () => void;
}) {
  const resolveQuery = useResolveTeamMemberRate(row.person_id, {
    projectId: row.project_id || invoice.projectId || null,
    workType: row.work_type || null,
    effectiveDate: invoice.issueDate,
    enabled: !!row.person_id,
  });

  useEffect(() => {
    const rate = resolveQuery.data?.rate;
    if (!rate || row.calculation_basis === "manual") return;
    if (row.calculation_basis === "hours_x_rate" || row.calculation_basis === "days_x_rate") {
      const qty = parseFloat(row.quantity);
      if (qty > 0) {
        onChange({
          amount: String(qty * rate.amount),
          currency: rate.currency,
          source_rate_id: rate.id,
          unit_amount: rate.amount,
        });
      }
    }
  }, [resolveQuery.data?.rate, row.calculation_basis, row.quantity]);

  useEffect(() => {
    if (row.calculation_basis !== "percentage_of_client_invoice") return;
    const pct = parseFloat(row.percentage);
    const base = invoice.total ?? invoice.amount ?? 0;
    if (pct > 0 && base > 0) {
      onChange({
        amount: String(Math.round((pct / 100) * base * 100) / 100),
        currency: invoice.currency ?? "EUR",
      });
    }
  }, [row.calculation_basis, row.percentage, invoice.total, invoice.amount, invoice.currency]);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Team member row</p>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Team member</Label>
          <Select value={toSelectValue(row.person_id)} onValueChange={(v) => onChange({ person_id: fromSelectValue(v) })}>
            <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
            <SelectContent>
              {teamMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Project</Label>
          <Select value={toSelectValue(row.project_id)} onValueChange={(v) => onChange({ project_id: fromSelectValue(v) })}>
            <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={toSelectValue("")}>— None —</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Calculation</Label>
          <Select
            value={row.calculation_basis}
            onValueChange={(v) => onChange({ calculation_basis: v as CompRow["calculation_basis"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual amount</SelectItem>
              <SelectItem value="hours_x_rate">Hours × rate</SelectItem>
              <SelectItem value="days_x_rate">Days × rate</SelectItem>
              <SelectItem value="percentage_of_client_invoice">% of client invoice</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {(row.calculation_basis === "hours_x_rate" || row.calculation_basis === "days_x_rate") && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Work type</Label>
            <Input value={row.work_type} onChange={(e) => onChange({ work_type: e.target.value })} placeholder="e.g. Development" />
          </div>
          <div className="space-y-1">
            <Label>{row.calculation_basis === "hours_x_rate" ? "Hours" : "Days"}</Label>
            <Input type="number" value={row.quantity} onChange={(e) => onChange({ quantity: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Suggested rate</Label>
            <p className="text-sm pt-2 tabular-nums">
              {resolveQuery.data?.rate
                ? `${resolveQuery.data.rate.amount} ${resolveQuery.data.rate.currency}/${resolveQuery.data.rate.rate_type === "daily" ? "day" : "hr"}`
                : "—"}
            </p>
          </div>
        </div>
      )}

      {row.calculation_basis === "percentage_of_client_invoice" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Percentage</Label>
            <Input type="number" value={row.percentage} onChange={(e) => onChange({ percentage: e.target.value })} placeholder="15" />
          </div>
          <div className="space-y-1">
            <Label>Calculated amount</Label>
            <p className="text-sm pt-2 tabular-nums">{row.amount ? formatCurrency(parseFloat(row.amount), row.currency) : "—"}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label>Amount</Label>
          <Input type="number" value={row.amount} onChange={(e) => onChange({ amount: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Currency</Label>
          <Select value={row.currency} onValueChange={(v) => onChange({ currency: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Release condition</Label>
          <Select
            value={row.release_condition}
            onValueChange={(v) => onChange({ release_condition: v as TeamMemberPayableReleaseCondition })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Immediate</SelectItem>
              <SelectItem value="when_client_invoice_paid">When client invoice paid</SelectItem>
              <SelectItem value="manual">Manual release</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Due date</Label>
          <Input type="date" value={row.due_date} onChange={(e) => onChange({ due_date: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
