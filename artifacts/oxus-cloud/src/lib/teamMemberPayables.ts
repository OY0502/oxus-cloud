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
  client_invoice_id?: string | null;
};

export function sumPayableAllocations(allocations: PayableAllocation[]): number {
  return allocations.reduce((s, a) => s + Number(a.allocated_amount), 0);
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
  clientInvoice?: { status?: string | null } | null,
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

export function payableUiStateLabel(state: PayableUiState): string {
  const labels: Record<PayableUiState, string> = {
    draft: "Draft",
    waiting_for_client_payment: "Waiting for client payment",
    waiting_for_release: "Waiting for release",
    ready_to_pay: "Ready to pay",
    partially_paid: "Partially paid",
    paid: "Paid",
    cancelled: "Cancelled",
    needs_review: "Needs review",
  };
  return labels[state];
}

export function releaseConditionLabel(condition: PayableReleaseCondition): string {
  const labels: Record<PayableReleaseCondition, string> = {
    immediate: "Immediate",
    when_client_invoice_paid: "When client invoice paid",
    manual: "Manual release",
  };
  return labels[condition];
}

export function payableStateVariant(state: PayableUiState): "success" | "warning" | "neutral" | "danger" {
  if (state === "paid") return "success";
  if (state === "ready_to_pay" || state === "partially_paid") return "warning";
  if (state === "cancelled" || state === "needs_review") return "danger";
  return "neutral";
}

export function isOpenPayable(state: PayableUiState): boolean {
  return ["ready_to_pay", "partially_paid", "waiting_for_client_payment", "waiting_for_release", "needs_review"].includes(state);
}

export function payableRemainingEur(
  payable: PayableForState & { paid_amount?: number },
): number | null {
  if (payable.amount_eur == null) return null;
  const ratio = payableRemainingAmount(payable, []) / Number(payable.amount);
  if (payable.paid_amount != null) {
    const remaining = Number(payable.amount) - payable.paid_amount;
    return Math.round((remaining / Number(payable.amount)) * Number(payable.amount_eur) * 100) / 100;
  }
  return Math.round(ratio * Number(payable.amount_eur) * 100) / 100;
}
