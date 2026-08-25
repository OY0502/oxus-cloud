import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  useChangeTeamMemberPayableState,
  useCreateTeamMemberPayable,
  useTeamPayablesSummary,
} from "@/hooks/api";
import { useToast } from "@/hooks/use-toast";
import { formatEUR, formatCurrency } from "@/lib/currency";
import {
  payableStateVariant,
  payableUiStateLabel,
  releaseConditionLabel,
} from "@/lib/teamMemberPayables";
import type { Contact, TeamMemberPayableEnriched } from "@/lib/types";
import { TeamMiniStat } from "./teamUi";
import { FormDialog, NumberField, SelectField, TextField } from "@/components/forms/FormKit";

interface TeamMemberPayablesPanelProps {
  person: Contact;
  canManage?: boolean;
  onRecordPayment?: (payableId?: string) => void;
}

export function TeamMemberPayablesPanel({
  person,
  canManage = false,
  onRecordPayment,
}: TeamMemberPayablesPanelProps) {
  const { toast } = useToast();
  const summaryQuery = useTeamPayablesSummary({ person_id: person.id, period: "lifetime" });
  const changeState = useChangeTeamMemberPayableState();
  const createPayable = useCreateTeamMemberPayable();
  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [title, setTitle] = useState("");
  const [releaseCondition, setReleaseCondition] = useState("immediate");

  const payables = summaryQuery.data?.payables ?? [];
  const summary = summaryQuery.data?.summary;

  const yearPaid = useMemo(() => {
    return payables
      .filter((p) => p.payment_status === "paid")
      .reduce((s, p) => s + (p.paid_amount_eur ?? 0), 0);
  }, [payables]);

  const act = async (payable: TeamMemberPayableEnriched, action: "approve" | "release" | "cancel") => {
    try {
      await changeState.mutateAsync({ payable_id: payable.id, action });
      toast({ title: `Payable updated` });
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const submitAdd = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    try {
      await createPayable.mutateAsync({
        person_id: person.id,
        amount: parsed,
        currency,
        title: title || "Team payable",
        release_condition: releaseCondition,
        calculation_basis: "manual",
      });
      toast({ title: "Payable created" });
      setAddOpen(false);
      setAmount("");
      setTitle("");
    } catch (e) {
      toast({
        title: "Could not create payable",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const columns = [
    {
      id: "desc",
      header: "Description",
      cell: (p: TeamMemberPayableEnriched) => p.title ?? p.description ?? "—",
    },
    {
      id: "project",
      header: "Project",
      cell: (p: TeamMemberPayableEnriched) => p.projects?.name ?? "—",
    },
    {
      id: "invoice",
      header: "Client invoice",
      cell: (p: TeamMemberPayableEnriched) => p.invoices?.number ?? "—",
    },
    {
      id: "native",
      header: "Amount",
      cell: (p: TeamMemberPayableEnriched) => formatCurrency(p.amount, p.currency),
    },
    {
      id: "remaining",
      header: "Remaining",
      cell: (p: TeamMemberPayableEnriched) => formatCurrency(p.remaining_amount, p.currency),
    },
    {
      id: "state",
      header: "State",
      cell: (p: TeamMemberPayableEnriched) => (
        <StatusBadge status={payableUiStateLabel(p.ui_state)} variant={payableStateVariant(p.ui_state)} />
      ),
    },
    {
      id: "due",
      header: "Due",
      cell: (p: TeamMemberPayableEnriched) => p.due_date ?? "—",
    },
    {
      id: "actions",
      header: "",
      cell: (p: TeamMemberPayableEnriched) => canManage ? (
        <div className="flex flex-wrap gap-1">
          {p.approval_status === "draft" && (
            <Button size="sm" variant="outline" onClick={() => void act(p, "approve")}>Approve</Button>
          )}
          {p.ui_state === "waiting_for_release" && (
            <Button size="sm" variant="outline" onClick={() => void act(p, "release")}>Release</Button>
          )}
          {["ready_to_pay", "partially_paid"].includes(p.ui_state) && onRecordPayment && (
            <Button size="sm" variant="outline" onClick={() => onRecordPayment(p.id)}>Pay</Button>
          )}
          {p.approval_status !== "cancelled" && p.payment_status !== "paid" && (
            <Button size="sm" variant="ghost" onClick={() => void act(p, "cancel")}>Cancel</Button>
          )}
        </div>
      ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <TeamMiniStat label="Outstanding" value={formatEUR(summary?.outstanding_eur?.total_eur ?? 0)} />
        <TeamMiniStat label="Ready to pay" value={formatEUR(summary?.ready_to_pay_eur?.total_eur ?? 0)} />
        <TeamMiniStat label="Waiting" value={formatEUR(summary?.waiting_eur?.total_eur ?? 0)} />
        <TeamMiniStat label="Paid this year" value={formatEUR(yearPaid)} />
      </div>

      {canManage && (
        <Button size="sm" onClick={() => setAddOpen(true)}>Add payable</Button>
      )}

      <DataTable
        data={payables}
        columns={columns}
        tableId={`team-member-payables-${person.id}`}
        pageSize={20}
        enablePagination
      />

      <FormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add payable"
        description={`Record compensation owed to ${person.name}.`}
        onSubmit={() => void submitAdd()}
        submitting={createPayable.isPending}
        submitLabel="Create payable"
        disabled={!amount.trim()}
      >
        <TextField label="Title" value={title} onChange={setTitle} placeholder="e.g. March development" />
        <NumberField label="Amount" value={amount} onChange={setAmount} required />
        <SelectField
          label="Currency"
          value={currency}
          onChange={setCurrency}
          options={[{ value: "EUR", label: "EUR" }, { value: "USD", label: "USD" }]}
        />
        <SelectField
          label="Release condition"
          value={releaseCondition}
          onChange={setReleaseCondition}
          options={[
            { value: "immediate", label: "Immediate" },
            { value: "when_client_invoice_paid", label: "When client invoice paid" },
            { value: "manual", label: "Manual release" },
          ]}
        />
      </FormDialog>
    </div>
  );
}
