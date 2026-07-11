import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { computeEurReporting } from "../_shared/teamFinancialFx.ts";
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
      amount?: number;
      currency?: string;
      payment_date?: string;
      period_start?: string | null;
      period_end?: string | null;
      project_id?: string | null;
      provider?: string;
      status?: string;
      notes?: string | null;
      allocations?: { contractor_invoice_id: string; allocated_amount: number }[];
      rate_id?: string | null;
    };

    const personId = body.person_id;
    const amount = Number(body.amount);
    if (!personId) return json({ error: "person_id is required." }, 400);
    if (!amount || amount <= 0) return json({ error: "amount must be positive." }, 400);

    const currency = validateCurrency(String(body.currency ?? "EUR"));
    const paymentDate = body.payment_date ?? new Date().toISOString().slice(0, 10);

    const admin = getServiceRoleSupabase();
    const fx = await computeEurReporting(admin, amount, currency, paymentDate);
    const allocations = body.allocations ?? [];
    const allocTotal = allocations.reduce((s, a) => s + Number(a.allocated_amount), 0);
    if (allocTotal > amount + 0.01) {
      return json({ error: "Allocated amount exceeds payment total." }, 400);
    }

    for (const alloc of allocations) {
      const { data: inv, error: invErr } = await admin
        .from("contractor_invoices")
        .select("id, person_id, total, paid_amount, status")
        .eq("id", alloc.contractor_invoice_id)
        .maybeSingle();
      if (invErr || !inv) return json({ error: `Invoice ${alloc.contractor_invoice_id} not found.` }, 404);
      if (inv.person_id !== personId) return json({ error: "Invoice does not belong to this person." }, 400);
      if (!["received", "approved", "partially_paid"].includes(inv.status)) {
        return json({ error: `Invoice ${alloc.contractor_invoice_id} is not open for payment.` }, 400);
      }
      const remaining = Number(inv.total) - Number(inv.paid_amount);
      if (Number(alloc.allocated_amount) > remaining + 0.01) {
        return json({ error: `Allocation exceeds remaining balance on invoice ${alloc.contractor_invoice_id}.` }, 400);
      }
    }

    const { data: payout, error: payoutErr } = await admin
      .from("payouts")
      .insert({
        person_id: personId,
        amount,
        currency,
        amount_eur: fx.amount_eur,
        fx_status: fx.fx_status,
        fx_rate_to_eur: fx.fx_rate_to_eur,
        fx_rate_date: fx.fx_rate_date,
        fx_source: fx.fx_source,
        rate_id: body.rate_id ?? null,
        payment_date: paymentDate,
        period_start: body.period_start ?? null,
        period_end: body.period_end ?? null,
        project_id: body.project_id ?? null,
        provider: body.provider ?? "manual",
        status: body.status ?? "paid",
        notes: body.notes ?? null,
        metadata: { created_by: auth.userId },
      })
      .select()
      .single();
    if (payoutErr) throw new Error(payoutErr.message);

    if (allocations.length > 0) {
      const rows = allocations.map((a) => ({
        contractor_invoice_id: a.contractor_invoice_id,
        payout_id: payout.id,
        allocated_amount: a.allocated_amount,
      }));
      const { error: allocErr } = await admin.from("contractor_invoice_payments").insert(rows);
      if (allocErr) throw new Error(allocErr.message);
    }

    await admin.from("activities").insert({
      kind: "info",
      title: "Payment recorded",
      description: `${amount} ${currency} · ${body.provider ?? "manual"}`,
      entity_type: "payout",
      entity_id: payout.id,
      contact_id: personId,
      visibility: "admin_only",
      created_by: auth.userId,
    });

    return json({ payout });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[allocate-invoice-payment]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
