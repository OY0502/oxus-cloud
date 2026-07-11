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

const STATUS_ACTIONS: Record<string, string> = {
  approve: "approved",
  dispute: "disputed",
  cancel: "cancelled",
};

async function assertPersonAccess(admin: ReturnType<typeof getServiceRoleSupabase>, personId: string) {
  const { data, error } = await admin.from("contacts").select("id").eq("id", personId).maybeSingle();
  if (error || !data) throw new Error("Team member not found.");
}

async function assertProjectAccess(
  admin: ReturnType<typeof getServiceRoleSupabase>,
  projectId: string | null | undefined,
) {
  if (!projectId) return;
  const { data, error } = await admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (error || !data) throw new Error("Project not found.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const auth = await assertSuperAdminUser(req);
    const body = await req.json() as Record<string, unknown>;
    const admin = getServiceRoleSupabase();

    if (body.action === "create") {
      const personId = body.person_id as string;
      if (!personId) return json({ error: "person_id is required." }, 400);
      await assertPersonAccess(admin, personId);
      await assertProjectAccess(admin, body.project_id as string | null);

      const total = Number(body.total);
      if (!total || total <= 0) return json({ error: "total must be positive." }, 400);
      if (!body.invoice_date) return json({ error: "invoice_date is required." }, 400);

      const currency = validateCurrency(String(body.currency ?? "EUR"));
      const invoiceDate = String(body.invoice_date);
      const fx = await computeEurReporting(admin, total, currency, invoiceDate);

      const { data, error } = await admin
        .from("contractor_invoices")
        .insert({
          person_id: personId,
          project_id: (body.project_id as string) ?? null,
          invoice_number: (body.invoice_number as string) ?? null,
          invoice_date: invoiceDate,
          due_date: (body.due_date as string) ?? null,
          period_start: (body.period_start as string) ?? null,
          period_end: (body.period_end as string) ?? null,
          currency,
          subtotal: Number(body.subtotal ?? total),
          tax_amount: Number(body.tax_amount ?? 0),
          total,
          total_eur: fx.amount_eur,
          fx_status: fx.fx_status,
          fx_rate_to_eur: fx.fx_rate_to_eur,
          fx_rate_date: fx.fx_rate_date,
          fx_source: fx.fx_source,
          description: (body.description as string) ?? null,
          source: (body.source as string) ?? "manual",
          status: (body.status as string) ?? "received",
          file_path: (body.file_path as string) ?? null,
          created_by: auth.userId,
        })
        .select("*, projects(id, name)")
        .single();

      if (error) throw new Error(error.message);
      return json({ invoice: data });
    }

    if (body.action === "update") {
      const invoiceId = body.invoice_id as string;
      if (!invoiceId) return json({ error: "invoice_id is required." }, 400);
      const patch = (body.patch ?? {}) as Record<string, unknown>;
      if (patch.project_id) await assertProjectAccess(admin, patch.project_id as string);

      const { data: existing, error: fetchErr } = await admin
        .from("contractor_invoices")
        .select("id, status")
        .eq("id", invoiceId)
        .maybeSingle();
      if (fetchErr || !existing) return json({ error: "Invoice not found." }, 404);
      if (existing.status === "paid" && patch.status !== "disputed") {
        return json({ error: "Paid invoices cannot be edited." }, 400);
      }

      if (patch.total != null || patch.currency != null) {
        const { data: full } = await admin
          .from("contractor_invoices")
          .select("total, currency, invoice_date")
          .eq("id", invoiceId)
          .maybeSingle();
        const total = Number(patch.total ?? full?.total);
        const currency = validateCurrency(String(patch.currency ?? full?.currency ?? "EUR"));
        const invoiceDate = String(patch.invoice_date ?? full?.invoice_date ?? new Date().toISOString().slice(0, 10));
        const fx = await computeEurReporting(admin, total, currency, invoiceDate);
        Object.assign(patch, {
          total_eur: fx.amount_eur,
          fx_status: fx.fx_status,
          fx_rate_to_eur: fx.fx_rate_to_eur,
          fx_rate_date: fx.fx_rate_date,
          fx_source: fx.fx_source,
        });
      }

      const { data, error } = await admin
        .from("contractor_invoices")
        .update(patch)
        .eq("id", invoiceId)
        .select("*, projects(id, name)")
        .single();
      if (error) throw new Error(error.message);
      return json({ invoice: data });
    }

    const action = body.action as string;
    if (action in STATUS_ACTIONS) {
      const invoiceId = body.invoice_id as string;
      if (!invoiceId) return json({ error: "invoice_id is required." }, 400);
      const newStatus = STATUS_ACTIONS[action];
      const { data, error } = await admin
        .from("contractor_invoices")
        .update({ status: newStatus })
        .eq("id", invoiceId)
        .select("*, projects(id, name)")
        .single();
      if (error) throw new Error(error.message);
      return json({ invoice: data });
    }

    return json({ error: "Invalid action." }, 400);
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[contractor-invoices]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
