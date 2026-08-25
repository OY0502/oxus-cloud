import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import {
  buildPayableInsertRow,
  enrichPayableWithAllocations,
  logPayableActivity,
  type PayableRowInput,
} from "../_shared/teamMemberPayables.ts";
import { computeEurReporting } from "../_shared/teamFinancialFx.ts";

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
      action?: string;
      payable_id?: string;
      person_id?: string;
      client_invoice_id?: string;
      project_id?: string;
      patch?: Record<string, unknown>;
      rows?: PayableRowInput[];
      auto_approve?: boolean;
    } & PayableRowInput;

    const admin = getServiceRoleSupabase();
    const action = body.action ?? "create";

    if (action === "create") {
      const row = await buildPayableInsertRow(admin, {
        person_id: body.person_id!,
        project_id: body.project_id,
        client_invoice_id: body.client_invoice_id,
        contractor_invoice_id: body.contractor_invoice_id,
        title: body.title,
        description: body.description,
        work_type: body.work_type,
        calculation_basis: body.calculation_basis,
        source_rate_id: body.source_rate_id,
        quantity: body.quantity,
        unit_amount: body.unit_amount,
        unit_currency: body.unit_currency,
        percentage: body.percentage,
        currency: body.currency ?? "EUR",
        amount: Number(body.amount),
        period_start: body.period_start,
        period_end: body.period_end,
        due_date: body.due_date,
        approval_status: body.approval_status,
        release_condition: body.release_condition,
        notes: body.notes,
        auto_approve: body.auto_approve,
      }, auth.userId);

      const { data, error } = await admin.from("team_member_payables").insert(row).select().single();
      if (error) throw new Error(error.message);

      await logPayableActivity(admin, {
        title: "Payable created",
        description: `${data.amount} ${data.currency}`,
        entityId: data.id,
        personId: data.person_id,
        createdBy: auth.userId,
        metadata: { approval_status: data.approval_status },
      });

      const [enriched] = await enrichPayableWithAllocations(admin, [data]);
      return json({ payable: enriched });
    }

    if (action === "bulk_create") {
      const rows = body.rows ?? [];
      if (rows.length === 0) return json({ error: "rows is required." }, 400);

      const inserts = [];
      for (const r of rows) {
        inserts.push(await buildPayableInsertRow(admin, {
          ...r,
          auto_approve: body.auto_approve ?? r.auto_approve ?? true,
        }, auth.userId));
      }

      const { data, error } = await admin.from("team_member_payables").insert(inserts).select();
      if (error) throw new Error(error.message);

      for (const p of data ?? []) {
        await logPayableActivity(admin, {
          title: "Payable created",
          description: `${p.amount} ${p.currency}`,
          entityId: p.id,
          personId: p.person_id,
          createdBy: auth.userId,
          metadata: { client_invoice_id: p.client_invoice_id },
        });
      }

      const enriched = await enrichPayableWithAllocations(admin, data ?? []);
      return json({ payables: enriched });
    }

    if (action === "update") {
      const payableId = body.payable_id;
      if (!payableId) return json({ error: "payable_id is required." }, 400);

      const { data: existing, error: fetchErr } = await admin
        .from("team_member_payables")
        .select("*")
        .eq("id", payableId)
        .maybeSingle();
      if (fetchErr || !existing) return json({ error: "Payable not found." }, 404);
      if (existing.approval_status === "cancelled") {
        return json({ error: "Cannot edit a cancelled payable." }, 400);
      }

      const patch = body.patch ?? {};
      const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };

      if (patch.amount != null || patch.currency != null) {
        const amount = Number(patch.amount ?? existing.amount);
        const currency = String(patch.currency ?? existing.currency);
        const rateDate = String(patch.period_end ?? existing.period_end ?? existing.period_start ?? existing.created_at).slice(0, 10);
        const fx = await computeEurReporting(admin, amount, currency, rateDate);
        update.amount = amount;
        update.currency = currency;
        update.amount_eur = fx.amount_eur;
        update.fx_status = fx.fx_status;
        update.fx_rate_to_eur = fx.fx_rate_to_eur;
        update.fx_rate_date = fx.fx_rate_date;
        update.fx_rate_source = fx.fx_source;
      }

      const { data, error } = await admin
        .from("team_member_payables")
        .update(update)
        .eq("id", payableId)
        .select()
        .single();
      if (error) throw new Error(error.message);

      await logPayableActivity(admin, {
        title: "Payable edited",
        entityId: data.id,
        personId: data.person_id,
        createdBy: auth.userId,
      });

      const [enriched] = await enrichPayableWithAllocations(admin, [data]);
      return json({ payable: enriched });
    }

    if (action === "link_contractor_invoice") {
      const payableId = body.payable_id;
      const contractorInvoiceId = body.contractor_invoice_id as string | undefined;
      if (!payableId || !contractorInvoiceId) {
        return json({ error: "payable_id and contractor_invoice_id are required." }, 400);
      }

      const { data, error } = await admin
        .from("team_member_payables")
        .update({ contractor_invoice_id: contractorInvoiceId, updated_at: new Date().toISOString() })
        .eq("id", payableId)
        .select()
        .single();
      if (error) throw new Error(error.message);

      await logPayableActivity(admin, {
        title: "Supporting invoice linked",
        entityId: data.id,
        personId: data.person_id,
        createdBy: auth.userId,
        metadata: { contractor_invoice_id: contractorInvoiceId },
      });

      const [enriched] = await enrichPayableWithAllocations(admin, [data]);
      return json({ payable: enriched });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[team-member-payables]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
