import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const FRANKFURTER_BASE = "https://api.frankfurter.app";

export type FxRateLookup = {
  rate: number;
  rateDate: string;
  cached: boolean;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fetch ECB reference rate via Frankfurter for a specific historical date. */
export async function getHistoricalRateToEur(
  admin: SupabaseClient,
  baseCurrency: string,
  rateDate: string,
): Promise<FxRateLookup | null> {
  const base = baseCurrency.toUpperCase();
  if (base === "EUR") {
    return { rate: 1, rateDate, cached: true };
  }

  const { data: cached } = await admin
    .from("fx_rates")
    .select("rate, rate_date")
    .eq("base_currency", base)
    .eq("quote_currency", "EUR")
    .eq("rate_date", rateDate)
    .maybeSingle();

  if (cached?.rate != null) {
    return { rate: Number(cached.rate), rateDate: cached.rate_date, cached: true };
  }

  try {
    const url = `${FRANKFURTER_BASE}/${rateDate}?from=${base}&to=EUR`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) {
      console.warn(`[frankfurterFx] ${base} ${rateDate}: HTTP ${resp.status}`);
      return null;
    }
    const body = await resp.json() as { rates?: Record<string, number>; date?: string };
    const rate = body.rates?.EUR;
    if (rate == null || !Number.isFinite(rate)) return null;

    const resolvedDate = body.date ?? rateDate;
    await admin.from("fx_rates").upsert(
      {
        base_currency: base,
        quote_currency: "EUR",
        rate_date: resolvedDate,
        rate,
        source: "frankfurter",
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "base_currency,quote_currency,rate_date" },
    );

    return { rate, rateDate: resolvedDate, cached: false };
  } catch (e) {
    console.warn(`[frankfurterFx] fetch failed ${base} ${rateDate}:`, (e as Error).message);
    return null;
  }
}

export function convertAmountToEur(amount: number, rate: number): number {
  return roundMoney(amount * rate);
}

export function invoiceFxReferenceDate(invoice: {
  paid_date?: string | null;
  issue_date?: string | null;
}): string {
  const raw = invoice.paid_date ?? invoice.issue_date;
  if (!raw) return new Date().toISOString().slice(0, 10);
  return raw.slice(0, 10);
}
