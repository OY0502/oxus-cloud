import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  deriveTeamMemberPayableState,
  enrichPayableWithAllocations,
  logPayableActivity,
  payableRemainingAmount,
  sumPayableAllocations,
} from "../_shared/teamMemberPayables.ts";
import { aggregateEurReporting, computeEurReporting } from "../_shared/teamFinancialFx.ts";
import { validateCurrency } from "../_shared/teamMemberRates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const auth = await assertSuperAdminUser(req);
    const body = await req.json() as {
      person_id?: string;
      client_invoice_id?: string;
      project_id?: string;
      period?: "mtd" | "ytd" | "lifetime";
      include_reconciliation?: boolean;
    };

    const admin = getServiceRoleSupabase();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const period = body.period ?? "lifetime";

    let query = admin.from("team_member_payables").select(`
      *,
      contacts:person_id(id, name),
      projects:project_id(id, name),
      invoices:client_invoice_id(id, number, status, client_name, total_eur, currency, total)
    `);

    if (body.person_id) query = query.eq("person_id", body.person_id);
    if (body.client_invoice_id) query = query.eq("client_invoice_id", body.client_invoice_id);
    if (body.project_id) query = query.eq("project_id", body.project_id);

    const { data: payables, error } = await query.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const clientInvoiceMap = new Map<string, { status: string }>();
    for (const p of payables ?? []) {
      const inv = p.invoices as { id: string; status: string } | null;
      if (inv?.id) clientInvoiceMap.set(inv.id, { status: inv.status });
    }

    const enriched = await enrichPayableWithAllocations(
      admin,
      (payables ?? []).map((p) => ({
        ...p,
        id: p.id,
        person_id: p.person_id,
        amount: Number(p.amount),
        currency: p.currency,
        amount_eur: p.amount_eur,
        approval_status: p.approval_status,
        release_condition: p.release_condition,
        released_at: p.released_at,
        needs_review: p.needs_review,
      })),
      clientInvoiceMap,
    );

    const approved = enriched.filter((p) => p.approval_status === "approved");

    const outstandingLines = approved
      .filter((p) => p.payment_status !== "paid")
      .map((p) => ({
        amount: p.remaining_amount,
        currency: p.currency,
        date: (p.period_end ?? p.period_start ?? p.created_at).slice(0, 10),
        amount_eur: p.amount_eur != null
          ? Math.round((p.remaining_amount / Number(p.amount)) * Number(p.amount_eur) * 100) / 100
          : null,
      }));

    const readyLines = approved
      .filter((p) => ["ready_to_pay", "partially_paid"].includes(p.ui_state))
      .map((p) => ({
        amount: p.remaining_amount,
        currency: p.currency,
        date: (p.period_end ?? p.period_start ?? p.created_at).slice(0, 10),
        amount_eur: p.amount_eur != null
          ? Math.round((p.remaining_amount / Number(p.amount)) * Number(p.amount_eur) * 100) / 100
          : null,
      }));

    const waitingLines = approved
      .filter((p) => ["waiting_for_client_payment", "waiting_for_release", "needs_review"].includes(p.ui_state))
      .map((p) => ({
        amount: p.remaining_amount,
        currency: p.currency,
        date: (p.period_end ?? p.period_start ?? p.created_at).slice(0, 10),
        amount_eur: p.amount_eur != null
          ? Math.round((p.remaining_amount / Number(p.amount)) * Number(p.amount_eur) * 100) / 100
          : null,
      }));

    const { data: payoutAllocs } = await admin
      .from("team_member_payable_payments")
      .select("allocated_amount_eur, allocated_amount, created_at, payouts!inner(payment_date, status, person_id)")
      .eq("payouts.status", "paid");

    const paidMtdLines = (payoutAllocs ?? [])
      .filter((a) => {
        const payout = a.payouts as { payment_date: string | null; person_id: string };
        if (body.person_id && payout.person_id !== body.person_id) return false;
        if (!payout.payment_date) return period === "lifetime";
        const d = new Date(payout.payment_date);
        if (period === "ytd") return d.getFullYear() === year;
        if (period === "mtd") return d.getFullYear() === year && d.getMonth() === month;
        return true;
      })
      .map((a) => ({
        amount: Number(a.allocated_amount),
        currency: "EUR",
        date: String((a.payouts as { payment_date: string }).payment_date ?? a.created_at).slice(0, 10),
        amount_eur: a.allocated_amount_eur != null ? Number(a.allocated_amount_eur) : null,
      }));

    const outstandingAgg = await aggregateEurReporting(admin, outstandingLines.filter((l) => l.amount_eur != null).map((l) => ({
      amount: l.amount_eur!,
      currency: "EUR",
      date: l.date,
    })));
    const readyAgg = await aggregateEurReporting(admin, readyLines.filter((l) => l.amount_eur != null).map((l) => ({
      amount: l.amount_eur!,
      currency: "EUR",
      date: l.date,
    })));
    const waitingAgg = await aggregateEurReporting(admin, waitingLines.filter((l) => l.amount_eur != null).map((l) => ({
      amount: l.amount_eur!,
      currency: "EUR",
      date: l.date,
    })));
    const paidMtdAgg = await aggregateEurReporting(admin, paidMtdLines.filter((l) => l.amount_eur != null).map((l) => ({
      amount: l.amount_eur!,
      currency: "EUR",
      date: l.date,
    })));

    const fxUnavailableCount = approved.filter((p) => p.payment_status !== "paid" && p.amount_eur == null).length;

    let clientInvoiceSummary = null;
    if (body.client_invoice_id) {
      const linked = enriched.filter((p) => p.approval_status === "approved");
      const allocatedEur = linked.reduce((s, p) => s + (p.amount_eur ?? 0), 0);
      const paidEur = linked.reduce((s, p) => s + (p.paid_amount_eur ?? 0), 0);
      const remainingEur = linked.reduce((s, p) => {
        if (p.amount_eur == null) return s;
        const ratio = p.remaining_amount / Number(p.amount);
        return s + ratio * Number(p.amount_eur);
      }, 0);

      const { data: clientInv } = await admin
        .from("invoices")
        .select("total_eur, total, currency, status")
        .eq("id", body.client_invoice_id)
        .maybeSingle();

      const revenueEur = clientInv?.total_eur ?? null;
      clientInvoiceSummary = {
        allocated_eur: Math.round(allocatedEur * 100) / 100,
        paid_eur: Math.round(paidEur * 100) / 100,
        remaining_eur: Math.round(remainingEur * 100) / 100,
        revenue_eur: revenueEur,
        margin_eur: revenueEur != null ? Math.round((revenueEur - allocatedEur) * 100) / 100 : null,
        margin_pct: revenueEur != null && revenueEur > 0
          ? Math.round(((revenueEur - allocatedEur) / revenueEur) * 10000) / 100
          : null,
        team_member_count: new Set(linked.map((p) => p.person_id)).size,
        payables: linked,
      };
    }

    let reconciliation = null;
    if (body.include_reconciliation) {
      const { data: unallocated } = await admin.from("unallocated_payouts_report").select("*");
      const { data: openContractorInvoices } = await admin
        .from("contractor_invoices")
        .select("id, person_id, total, paid_amount, status, currency")
        .in("status", ["received", "approved", "partially_paid"]);
      reconciliation = {
        unallocated_payouts: unallocated ?? [],
        unpaid_contractor_invoices: (openContractorInvoices ?? []).filter(
          (i) => Number(i.paid_amount) < Number(i.total),
        ),
        payable_count: enriched.length,
      };
    }

    return json({
      period,
      payables: enriched,
      summary: {
        outstanding_eur: outstandingAgg,
        ready_to_pay_eur: readyAgg,
        waiting_eur: waitingAgg,
        paid_period_eur: paidMtdAgg,
        payable_count: approved.filter((p) => p.payment_status !== "paid").length,
        ready_count: approved.filter((p) => ["ready_to_pay", "partially_paid"].includes(p.ui_state)).length,
        fx_unavailable_count: fxUnavailableCount,
      },
      client_invoice: clientInvoiceSummary,
      reconciliation,
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[get-team-payables-summary]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
