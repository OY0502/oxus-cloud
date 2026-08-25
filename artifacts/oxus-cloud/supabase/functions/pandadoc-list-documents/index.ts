import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { listPandaDocDocuments, PandaDocError } from "../_shared/pandadoc.ts";

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

    let body: { query?: string; status?: string; page?: number; count?: number } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }

    const result = await listPandaDocDocuments({
      query: body.query,
      status: body.status,
      page: body.page,
      count: body.count,
    });

    return json({
      documents: result.results,
      page: result.page,
      count: result.count,
    });
  } catch (e) {
    if (e instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(e, corsHeaders);
    if (e instanceof PandaDocError) {
      return json({ error: e.message, code: e.code, details: e.details }, e.status);
    }
    console.error("[pandadoc-list-documents]", (e as Error).message);
    return json({ error: "Unexpected error." }, 500);
  }
});
