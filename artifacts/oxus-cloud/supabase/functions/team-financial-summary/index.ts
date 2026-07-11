import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { aggregateEurReporting } from "../_shared/teamFinancialFx.ts";

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
    await assertSuperAdminUser(req);
    const body = await req.json() as {
      person_id?: string;
      period?: "mtd" | "ytd" | "lifetime";
    };

    const personId = body.person_id;
    if (!personId) return json({ error: "person_id is required." }, 400);

    const admin = getServiceRoleSupabase();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const period = body.period ?? "mtd";

    const { data: payouts, error: payoutsErr } = await admin
      .from("payouts")
      .select("amount, currency, payment_date, amount_eur, fx_status, fx_rate_to_eur, fx_rate_date")
      .eq("person_id", personId)
      .eq("status", "paid");
    if (payoutsErr) throw new Error(payoutsErr.message);

    const { data: invoices, error: invErr } = await admin
      .from("contractor_invoices")
      .select("total, currency, invoice_date, total_eur, fx_status, paid_amount, status")
      .eq("person_id", personId);
    if (invErr) throw new Error(invErr.message);

    const paidPayouts = (payouts ?? []).filter((p) => {
      if (!p.payment_date) return period === "lifetime";
      const d = new Date(p.payment_date);
      if (period === "ytd") return d.getFullYear() === year;
      if (period === "mtd") return d.getFullYear() === year && d.getMonth() === month;
      return true;
    });

    const payoutLines = paidPayouts.map((p) => ({
      amount: Number(p.amount),
      currency: String(p.currency),
      date: String(p.payment_date ?? new Date().toISOString().slice(0, 10)),
    }));

    const openInvoices = (invoices ?? []).filter((i) =>
      ["received", "approved", "partially_paid"].includes(i.status),
    );
    const invoiceLines = openInvoices.map((i) => ({
      amount: Math.max(0, Number(i.total) - Number(i.paid_amount ?? 0)),
      currency: String(i.currency),
      date: String(i.invoice_date),
    }));

    const paidAgg = await aggregateEurReporting(admin, payoutLines);
    const outstandingAgg = await aggregateEurReporting(admin, invoiceLines);

    return json({
      period,
      paid: paidAgg,
      outstanding_invoices: outstandingAgg,
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[team-financial-summary]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
