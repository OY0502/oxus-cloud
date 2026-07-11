-- Invoice EUR reporting fields and FX rate cache (Frankfurter / ECB historical)

alter table public.invoices
  add column if not exists amount_due_eur numeric(14,2),
  add column if not exists amount_paid_eur numeric(14,2),
  add column if not exists subtotal_eur numeric(14,2),
  add column if not exists tax_amount_eur numeric(14,2),
  add column if not exists fx_status text,
  add column if not exists fx_rate_to_eur numeric(18,8),
  add column if not exists fx_rate_date date;

alter table public.invoices drop constraint if exists invoices_fx_status_check;
alter table public.invoices
  add constraint invoices_fx_status_check
  check (fx_status is null or fx_status in ('native_eur', 'converted', 'pending', 'failed', 'unavailable'));

create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  quote_currency text not null default 'EUR',
  rate_date date not null,
  rate numeric(18,8) not null,
  source text not null default 'frankfurter',
  fetched_at timestamptz not null default now(),
  unique(base_currency, quote_currency, rate_date)
);

create index if not exists idx_fx_rates_lookup
  on public.fx_rates (base_currency, quote_currency, rate_date);

-- Backfill native EUR invoices
update public.invoices
set
  amount_eur = coalesce(amount_eur, total, amount),
  amount_due_eur = coalesce(amount_due_eur, amount_due, greatest(coalesce(total, amount) - coalesce(amount_paid, 0), 0)),
  amount_paid_eur = coalesce(amount_paid_eur, amount_paid, 0),
  subtotal_eur = coalesce(subtotal_eur, subtotal, total, amount),
  tax_amount_eur = coalesce(tax_amount_eur, tax_amount, 0),
  fx_status = coalesce(fx_status, 'native_eur'),
  fx_rate_to_eur = coalesce(fx_rate_to_eur, 1),
  fx_rate_date = coalesce(fx_rate_date, issue_date::date)
where upper(currency) = 'EUR';

-- Mark non-EUR invoices awaiting conversion
update public.invoices
set fx_status = coalesce(fx_status, 'pending')
where upper(currency) <> 'EUR' and amount_eur is null and fx_status is null;
