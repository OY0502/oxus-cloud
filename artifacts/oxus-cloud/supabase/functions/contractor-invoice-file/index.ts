import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";

const BUCKET = "contractor-invoices";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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
    const body = await req.json() as Record<string, unknown>;
    const admin = getServiceRoleSupabase();
    const invoiceId = body.invoice_id as string;
    if (!invoiceId) return json({ error: "invoice_id is required." }, 400);

    const { data: invoice, error: invErr } = await admin
      .from("contractor_invoices")
      .select("id, person_id, file_path")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return json({ error: "Invoice not found." }, 404);

    if (body.action === "upload") {
      const personId = body.person_id as string;
      if (personId !== invoice.person_id) return json({ error: "Person mismatch." }, 403);

      const contentType = (body.content_type as string) ?? "";
      if (!ALLOWED_TYPES.has(contentType)) {
        return json({ error: "File type not allowed. Use PDF or image." }, 400);
      }

      const base64 = body.file_base64 as string;
      if (!base64) return json({ error: "file_base64 is required." }, 400);

      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      if (bytes.length > MAX_BYTES) return json({ error: "File exceeds 10 MB limit." }, 400);

      const safeName = ((body.file_name as string) ?? "invoice").replace(/[^\w.\-]+/g, "_");
      const path = `${invoice.person_id}/${invoiceId}/${Date.now()}_${safeName}`;

      if (invoice.file_path) {
        await admin.storage.from(BUCKET).remove([invoice.file_path]);
      }

      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType,
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message);

      const { error: updErr } = await admin
        .from("contractor_invoices")
        .update({ file_path: path, source: "uploaded_file" })
        .eq("id", invoiceId);
      if (updErr) throw new Error(updErr.message);

      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);
      if (signErr) throw new Error(signErr.message);

      return json({ file_path: path, signed_url: signed?.signedUrl ?? null });
    }

    if (body.action === "download") {
      if (!invoice.file_path) return json({ error: "No attachment on this invoice." }, 404);
      const { data: signed, error: signErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(invoice.file_path, 3600);
      if (signErr) throw new Error(signErr.message);
      return json({ signed_url: signed?.signedUrl ?? null });
    }

    return json({ error: "Invalid action." }, 400);
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    console.error("[contractor-invoice-file]", (e as Error).message);
    return json({ error: (e as Error).message }, 400);
  }
});
