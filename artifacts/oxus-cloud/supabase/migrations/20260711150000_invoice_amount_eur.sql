-- EUR equivalent for multi-currency invoice reporting
alter table public.invoices
  add column if not exists amount_eur numeric(14,2);

-- Backfill EUR invoices
update public.invoices
set amount_eur = coalesce(total, amount)
where upper(currency) = 'EUR' and amount_eur is null;
