import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { computeEurReporting } from "./teamFinancialFx.ts";
import { validateCurrency } from "./teamMemberRates.ts";

export type PayableCalculationBasis =
  | "manual"
  | "hours_x_rate"
  | "days_x_rate"
  | "percentage_of_client_invoice"
  | "fixed_project";

export type PayableApprovalStatus = "draft" | "approved" | "cancelled";

export type PayableReleaseCondition = "immediate" | "when_client_invoice_paid" | "manual";

export type PayablePaymentStatus = "unpaid" | "partially_paid" | "paid";

export type PayableUiState =
  | "draft"
  | "waiting_for_client_payment"
  | "waiting_for_release"
  | "ready_to_pay"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "needs_review";

export type PayableAllocation = {
  allocated_amount: number;
  allocated_amount_eur?: number | null;
};

export type PayableForState = {
  id: string;
  person_id: string;
  amount: number;
  currency: string;
  amount_eur?: number | null;
  approval_status: PayableApprovalStatus;
  release_condition: PayableReleaseCondition;
  released_at?: string | null;
  needs_review?: boolean;
};

export type ClientInvoiceForState = {
  status?: string | null;
} | null | undefined;

export function sumPayableAllocations(allocations: PayableAllocation[]): number {
  return allocations.reduce((s, a) => s + Number(a.allocated_amount), 0);
}

export function sumPayableAllocationsEur(allocations: PayableAllocation[]): number | null {
  let total = 0;
  let hasNull = false;
  for (const a of allocations) {
    if (a.allocated_amount_eur == null) {
      hasNull = true;
      continue;
    }
    total += Number(a.allocated_amount_eur);
  }
  return hasNull ? null : Math.round(total * 100) / 100;
}

export function derivePayablePaymentStatus(
  payableAmount: number,
  allocatedAmount: number,
): PayablePaymentStatus {
  if (allocatedAmount <= 0) return "unpaid";
  if (allocatedAmount >= payableAmount - 0.01) return "paid";
  return "partially_paid";
}

export function deriveTeamMemberPayableState(
  payable: PayableForState,
  allocations: PayableAllocation[],
  clientInvoice?: ClientInvoiceForState,
): PayableUiState {
  if (payable.approval_status === "cancelled") return "cancelled";
  if (payable.approval_status === "draft") return "draft";

  const allocated = sumPayableAllocations(allocations);
  const paymentStatus = derivePayablePaymentStatus(Number(payable.amount), allocated);

  if (paymentStatus === "paid") return "paid";
  if (paymentStatus === "partially_paid") return "partially_paid";

  if (payable.needs_review) return "needs_review";

  const invoiceStatus = clientInvoice?.status ?? null;
  if (
    payable.release_condition === "when_client_invoice_paid"
    && !payable.released_at
    && invoiceStatus
    && ["void", "uncollectible"].includes(invoiceStatus)
  ) {
    return "needs_review";
  }

  if (payable.release_condition === "when_client_invoice_paid" && !payable.released_at) {
    return "waiting_for_client_payment";
  }

  if (payable.release_condition === "manual" && !payable.released_at) {
    return "waiting_for_release";
  }

  return "ready_to_pay";
}

export function payableRemainingAmount(payable: PayableForState, allocations: PayableAllocation[]): number {
  return Math.max(0, Number(payable.amount) - sumPayableAllocations(allocations));
}

export function payableEffectiveDate(payable: {
  period_end?: string | null;
  period_start?: string | null;
  created_at?: string;
}): string {
  if (payable.period_end) return payable.period_end;
  if (payable.period_start) return payable.period_start;
  return (payable.created_at ?? new Date().toISOString()).slice(0, 10);
}

export async function computePayableEurReporting(
  admin: SupabaseClient,
  amount: number,
  currency: string,
  rateDate: string,
) {
  return computeEurReporting(admin, amount, validateCurrency(currency), rateDate);
}

export type PayableRowInput = {
  person_id: string;
  project_id?: string | null;
  client_invoice_id?: string | null;
  contractor_invoice_id?: string | null;
  title?: string | null;
  description?: string | null;
  work_type?: string | null;
  calculation_basis?: PayableCalculationBasis;
  source_rate_id?: string | null;
  quantity?: number | null;
  unit_amount?: number | null;
  unit_currency?: string | null;
  percentage?: number | null;
  currency: string;
  amount: number;
  period_start?: string | null;
  period_end?: string | null;
  due_date?: string | null;
  approval_status?: PayableApprovalStatus;
  release_condition?: PayableReleaseCondition;
  notes?: string | null;
  auto_approve?: boolean;
};

export async function buildPayableInsertRow(
  admin: SupabaseClient,
  input: PayableRowInput,
  createdBy: string | null,
): Promise<Record<string, unknown>> {
  const currency = validateCurrency(input.currency);
  const amount = Number(input.amount);
  const rateDate = payableEffectiveDate({
    period_end: input.period_end,
    period_start: input.period_start,
    created_at: new Date().toISOString(),
  });
  const fx = await computePayableEurReporting(admin, amount, currency, rateDate);

  const approvalStatus = input.auto_approve ? "approved" : (input.approval_status ?? "draft");
  const releaseCondition = input.release_condition ?? "immediate";
  const now = new Date().toISOString();

  let releasedAt: string | null = null;
  if (
    approvalStatus === "approved"
    && releaseCondition === "immediate"
  ) {
    releasedAt = now;
  }

  return {
    person_id: input.person_id,
    project_id: input.project_id ?? null,
    client_invoice_id: input.client_invoice_id ?? null,
    contractor_invoice_id: input.contractor_invoice_id ?? null,
    title: input.title ?? null,
    description: input.description ?? null,
    work_type: input.work_type ?? null,
    calculation_basis: input.calculation_basis ?? "manual",
    source_rate_id: input.source_rate_id ?? null,
    quantity: input.quantity ?? null,
    unit_amount: input.unit_amount ?? null,
    unit_currency: input.unit_currency ?? null,
    percentage: input.percentage ?? null,
    currency,
    amount,
    amount_eur: fx.amount_eur,
    fx_rate_to_eur: fx.fx_rate_to_eur,
    fx_rate_date: fx.fx_rate_date,
    fx_rate_source: fx.fx_source,
    fx_status: fx.fx_status,
    period_start: input.period_start ?? null,
    period_end: input.period_end ?? null,
    due_date: input.due_date ?? null,
    approval_status: approvalStatus,
    release_condition: releaseCondition,
    released_at: releasedAt,
    needs_review: false,
    created_by: createdBy,
    approved_by: input.auto_approve ? createdBy : null,
    approved_at: input.auto_approve ? now : null,
    notes: input.notes ?? null,
  };
}

export async function enrichPayableWithAllocations<T extends PayableForState>(
  admin: SupabaseClient,
  payables: T[],
  clientInvoices?: Map<string, { status: string }>,
): Promise<Array<T & {
  allocations: PayableAllocation[];
  paid_amount: number;
  paid_amount_eur: number | null;
  remaining_amount: number;
  payment_status: PayablePaymentStatus;
  ui_state: PayableUiState;
}>> {
  if (payables.length === 0) return [];

  const ids = payables.map((p) => p.id);
  const { data: allocs, error } = await admin
    .from("team_member_payable_payments")
    .select("payable_id, allocated_amount, allocated_amount_eur")
    .in("payable_id", ids);
  if (error) throw new Error(error.message);

  const byPayable = new Map<string, PayableAllocation[]>();
  for (const row of allocs ?? []) {
    const list = byPayable.get(row.payable_id) ?? [];
    list.push({
      allocated_amount: Number(row.allocated_amount),
      allocated_amount_eur: row.allocated_amount_eur != null ? Number(row.allocated_amount_eur) : null,
    });
    byPayable.set(row.payable_id, list);
  }

  return payables.map((payable) => {
    const allocations = byPayable.get(payable.id) ?? [];
    const paidAmount = sumPayableAllocations(allocations);
    const clientInvoice = payable && "client_invoice_id" in payable
      ? clientInvoices?.get((payable as T & { client_invoice_id?: string }).client_invoice_id ?? "")
      : undefined;

    return {
      ...payable,
      allocations,
      paid_amount: paidAmount,
      paid_amount_eur: sumPayableAllocationsEur(allocations),
      remaining_amount: payableRemainingAmount(payable, allocations),
      payment_status: derivePayablePaymentStatus(Number(payable.amount), paidAmount),
      ui_state: deriveTeamMemberPayableState(
        payable,
        allocations,
        clientInvoice ? { status: clientInvoice.status } : undefined,
      ),
    };
  });
}

export async function logPayableActivity(
  admin: SupabaseClient,
  params: {
    title: string;
    description?: string;
    entityId: string;
    personId?: string;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await admin.from("activities").insert({
    kind: "info",
    title: params.title,
    description: params.description ?? null,
    entity_type: "team_member_payable",
    entity_id: params.entityId,
    contact_id: params.personId ?? null,
    visibility: "admin_only",
    created_by: params.createdBy ?? null,
    metadata: params.metadata ?? {},
  });
}
