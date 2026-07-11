import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { convertAmountToEur, getHistoricalRateToEur } from "./frankfurterFx.ts";
import { validateCurrency } from "./teamMemberRates.ts";

export type FxReportingResult = {
  amount_eur: number | null;
  fx_status: "native_eur" | "converted" | "pending" | "failed" | "unavailable";
  fx_rate_to_eur: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
};

export async function computeEurReporting(
  admin: SupabaseClient,
  amount: number,
  currency: string,
  rateDate: string,
): Promise<FxReportingResult> {
  const ccy = validateCurrency(currency);
  if (ccy === "EUR") {
    return {
      amount_eur: amount,
      fx_status: "native_eur",
      fx_rate_to_eur: 1,
      fx_rate_date: rateDate,
      fx_source: "native",
    };
  }

  const lookup = await getHistoricalRateToEur(admin, ccy, rateDate);
  if (!lookup) {
    return {
      amount_eur: null,
      fx_status: "unavailable",
      fx_rate_to_eur: null,
      fx_rate_date: rateDate,
      fx_source: "frankfurter",
    };
  }

  return {
    amount_eur: convertAmountToEur(amount, lookup.rate),
    fx_status: "converted",
    fx_rate_to_eur: lookup.rate,
    fx_rate_date: lookup.rateDate,
    fx_source: "frankfurter",
  };
}

export type CurrencyBreakdownLine = {
  currency: string;
  native_amount: number;
  amount_eur: number | null;
  fx_rate_to_eur: number | null;
  fx_rate_date: string | null;
  count: number;
};

export async function aggregateEurReporting(
  admin: SupabaseClient,
  lines: { amount: number; currency: string; date: string }[],
): Promise<{
  total_eur: number | null;
  breakdown: CurrencyBreakdownLine[];
  has_unconverted: boolean;
}> {
  const byCurrency = new Map<string, { native: number; dates: string[]; count: number }>();

  for (const line of lines) {
    const ccy = line.currency.toUpperCase();
    const existing = byCurrency.get(ccy) ?? { native: 0, dates: [], count: 0 };
    existing.native += line.amount;
    existing.dates.push(line.date);
    existing.count += 1;
    byCurrency.set(ccy, existing);
  }

  const breakdown: CurrencyBreakdownLine[] = [];
  let totalEur = 0;
  let hasUnconverted = false;

  for (const [currency, data] of byCurrency) {
    const rateDate = data.dates.sort().reverse()[0];
    const fx = await computeEurReporting(admin, data.native, currency, rateDate);
    breakdown.push({
      currency,
      native_amount: data.native,
      amount_eur: fx.amount_eur,
      fx_rate_to_eur: fx.fx_rate_to_eur,
      fx_rate_date: fx.fx_rate_date,
      count: data.count,
    });
    if (fx.amount_eur != null) {
      totalEur += fx.amount_eur;
    } else {
      hasUnconverted = true;
    }
  }

  return {
    total_eur: hasUnconverted ? null : Math.round(totalEur * 100) / 100,
    breakdown,
    has_unconverted: hasUnconverted,
  };
}
