import { getServiceRoleSupabase } from "../_shared/clickup-auth.ts";
import {
  assertSuperAdminUser,
  InternalOxusAuthError,
  internalOxusAuthErrorResponse,
} from "../_shared/internalOxusAuth.ts";
import { findStatementMatches, findTransferMatches } from "../_shared/wiseApi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wise-probe-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function allowProbeRequest(req: Request): Promise<void> {
  const oneTimeKey = Deno.env.get("WISE_PROBE_ACCESS_KEY")?.trim();
  if (oneTimeKey && req.headers.get("x-wise-probe-key") === oneTimeKey) return;
  await assertSuperAdminUser(req);
}

type WiseResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error: string | null;
};

async function wiseGet(token: string, path: string): Promise<WiseResult> {
  const baseUrl = Deno.env.get("WISE_API_BASE_URL")?.trim() || "https://api.wise.com";
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-External-Correlation-Id": crypto.randomUUID(),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const message = data && typeof data === "object" && "message" in data
    ? String((data as { message?: unknown }).message ?? "")
    : null;
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? null : message || `Wise returned HTTP ${response.status}.`,
  };
}

function arrayData(result: WiseResult): unknown[] {
  if (Array.isArray(result.data)) return result.data;
  if (result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    for (const key of ["content", "data", "transfers", "transactions"]) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
  }
  return [];
}

function recordData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    await allowProbeRequest(req);
    const token = Deno.env.get("WISE_API_TOKEN")?.trim();
    if (!token) {
      return json({
        configured: false,
        error: "WISE_API_TOKEN has not been configured in Supabase Edge Function secrets.",
      }, 400);
    }

    const body = await req.json().catch(() => ({})) as {
      amount?: number;
      currency?: string;
      counterparty?: string;
      lookback_days?: number;
    };
    const amount = Number(body.amount ?? 2835);
    const currency = String(body.currency ?? "EUR").trim().toUpperCase();
    const counterparty = String(body.counterparty ?? "Vegard").trim();
    const lookbackDays = Math.min(Math.max(Number(body.lookback_days ?? 365), 1), 460);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "A positive amount is required." }, 400);

    const profilesResult = await wiseGet(token, "/v1/profiles");
    if (!profilesResult.ok) {
      return json({ configured: true, authenticated: false, profiles: { status: profilesResult.status, error: profilesResult.error } }, 502);
    }
    const profiles = arrayData(profilesResult);
    const businessProfile = profiles
      .map(recordData)
      .find((profile) => String(profile.type ?? "").toUpperCase() === "BUSINESS") ?? recordData(profiles[0]);
    const profileId = businessProfile.id;
    if (profileId == null) return json({ configured: true, authenticated: true, error: "No Wise profile was returned." }, 404);

    const transfersResult = await wiseGet(token, `/v1/transfers?profile=${encodeURIComponent(String(profileId))}&limit=100`);
    const transfers = transfersResult.ok ? arrayData(transfersResult) : [];
    const enrichedTransfers = [];
    for (const transferEntry of transfers) {
      const transfer = recordData(transferEntry);
      const sourceValue = Number(transfer.sourceValue);
      const targetValue = Number(transfer.targetValue);
      const isAmountCandidate = [sourceValue, targetValue].some((value) =>
        Number.isFinite(value) && Math.abs(Math.abs(value) - Math.abs(amount)) < 0.005
      );
      if (!isAmountCandidate || transfer.targetAccount == null) {
        enrichedTransfers.push(transfer);
        continue;
      }

      const recipientResult = await wiseGet(
        token,
        `/v2/accounts/${encodeURIComponent(String(transfer.targetAccount))}`,
      );
      const recipient = recordData(recipientResult.data);
      const recipientName = recordData(recipient.name);
      enrichedTransfers.push({
        ...transfer,
        recipientName: recipientName.fullName ?? recipient.accountHolderName ?? recipient.name ?? null,
      });
    }
    const transferMatches = transfersResult.ok
      ? findTransferMatches(enrichedTransfers, amount, counterparty)
      : [];

    const balancesResult = await wiseGet(token, `/v4/profiles/${encodeURIComponent(String(profileId))}/balances?types=STANDARD`);
    const balances = balancesResult.ok ? arrayData(balancesResult) : [];
    const intervalEnd = new Date();
    const intervalStart = new Date(intervalEnd.getTime() - lookbackDays * 86_400_000);
    const statementAttempts: Array<{ balance_id: string; currency: string; status: number; error: string | null }> = [];
    const statementMatches = [];

    for (const balanceEntry of balances) {
      const balance = recordData(balanceEntry);
      const balanceCurrency = String(balance.currency ?? "").toUpperCase();
      if (balanceCurrency !== currency || balance.id == null) continue;
      const query = new URLSearchParams({
        currency,
        intervalStart: intervalStart.toISOString(),
        intervalEnd: intervalEnd.toISOString(),
        type: "COMPACT",
      });
      const statementResult = await wiseGet(
        token,
        `/v1/profiles/${encodeURIComponent(String(profileId))}/balance-statements/${encodeURIComponent(String(balance.id))}/statement.json?${query}`,
      );
      statementAttempts.push({
        balance_id: String(balance.id),
        currency: balanceCurrency,
        status: statementResult.status,
        error: statementResult.error,
      });
      if (statementResult.ok) {
        const statement = recordData(statementResult.data);
        statementMatches.push(...findStatementMatches(
          Array.isArray(statement.transactions) ? statement.transactions : [],
          amount,
          counterparty,
        ));
      }
    }

    const admin = getServiceRoleSupabase();
    const { data: invoiceCandidates, error: invoiceError } = await admin
      .from("invoices")
      .select("id, number, client_name, amount, total, amount_paid, amount_due, currency, status, provider, external_id, issue_date, due_date, paid_at")
      .eq("currency", currency)
      .or(`amount.eq.${amount},total.eq.${amount}`)
      .order("issue_date", { ascending: false })
      .limit(20);
    if (invoiceError) throw new Error(invoiceError.message);

    const wiseMatches = [...statementMatches, ...transferMatches];
    return json({
      configured: true,
      authenticated: true,
      query: { amount, currency, counterparty, lookback_days: lookbackDays },
      profile: { id: String(profileId), type: businessProfile.type ?? null },
      capabilities: {
        transfers: { status: transfersResult.status, error: transfersResult.error },
        balances: { status: balancesResult.status, error: balancesResult.error },
        statements: statementAttempts,
      },
      wise_matches: wiseMatches,
      invoice_candidates: invoiceCandidates ?? [],
      unique_match: wiseMatches.length === 1,
      note: wiseMatches.length === 0 && statementAttempts.some((attempt) => attempt.status === 401 || attempt.status === 403)
        ? "The token authenticated, but Wise denied balance-statement access for this account."
        : null,
    });
  } catch (error) {
    if (error instanceof InternalOxusAuthError) return internalOxusAuthErrorResponse(error, corsHeaders);
    console.error("[wise-invoice-probe]", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
});
