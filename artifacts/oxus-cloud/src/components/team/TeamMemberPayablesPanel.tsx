import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  TeamEmptyState,
  TeamMiniStat,
  TeamOutlineButton,
  TeamPanelHeader,
  TeamRecordField,
  TeamRecordItem,
  TeamRecordList,
  teamActionBtn,
  teamIcon,
} from "./teamUi";
import { FormDialog, NumberField, SelectField, TextField } from "@/components/forms/FormKit";
import { MoreHorizontal, Plus } from "lucide-react";

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

  return (
    <div className="space-y-4">
      <TeamPanelHeader
        title="Payables"
        action={canManage ? (
          <TeamOutlineButton onClick={() => setAddOpen(true)}>
            <Plus className={teamIcon} /> Add payable
          </TeamOutlineButton>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <TeamMiniStat label="Outstanding" value={formatEUR(summary?.outstanding_eur?.total_eur ?? 0)} />
        <TeamMiniStat label="Ready to pay" value={formatEUR(summary?.ready_to_pay_eur?.total_eur ?? 0)} />
        <TeamMiniStat label="Waiting" value={formatEUR(summary?.waiting_eur?.total_eur ?? 0)} />
        <TeamMiniStat label="Paid this year" value={formatEUR(yearPaid)} />
      </div>

      {summaryQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading payables…</p>
      ) : payables.length === 0 ? (
        <TeamEmptyState
          title="No payables"
          description="Payables created for this member will appear here with approval and payment status."
        />
      ) : (
        <TeamRecordList>
          {payables.map((payable) => {
            const canApprove = payable.approval_status === "draft";
            const canRelease = payable.ui_state === "waiting_for_release";
            const canPay = ["ready_to_pay", "partially_paid"].includes(payable.ui_state) && !!onRecordPayment;
            const canCancel = payable.approval_status !== "cancelled" && payable.payment_status !== "paid";
            const hasActions = canManage && (canApprove || canRelease || canPay || canCancel);

            return (
              <TeamRecordItem
                key={payable.id}
                title={
                  <>
                    <span>{payable.title ?? payable.description ?? "Untitled payable"}</span>
                    <StatusBadge status={payableUiStateLabel(payable.ui_state)} variant={payableStateVariant(payable.ui_state)} />
                  </>
                }
                subtitle={payable.projects?.name ? `Project · ${payable.projects.name}` : "Manual compensation"}
                trailing={
                  <>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(payable.amount, payable.currency)}
                    </div>
                    {payable.remaining_amount !== payable.amount && (
                      <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {formatCurrency(payable.remaining_amount, payable.currency)} left
                      </div>
                    )}
                  </>
                }
                details={
                  <>
                    <TeamRecordField label="Client invoice">{payable.invoices?.number ?? "—"}</TeamRecordField>
                    <TeamRecordField label="Due">{payable.due_date ?? "—"}</TeamRecordField>
                    <TeamRecordField label="Release">{releaseConditionLabel(payable.release_condition)}</TeamRecordField>
                  </>
                }
                actions={hasActions ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className={teamActionBtn.menu} aria-label="Payable actions">
                        <MoreHorizontal className={teamIcon} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canApprove && <DropdownMenuItem onSelect={() => void act(payable, "approve")}>Approve payable</DropdownMenuItem>}
                      {canRelease && <DropdownMenuItem onSelect={() => void act(payable, "release")}>Release payable</DropdownMenuItem>}
                      {canPay && <DropdownMenuItem onSelect={() => onRecordPayment?.(payable.id)}>Record payment</DropdownMenuItem>}
                      {canCancel && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void act(payable, "cancel")}>
                            Cancel payable
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : undefined}
              />
            );
          })}
        </TeamRecordList>
      )}

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
