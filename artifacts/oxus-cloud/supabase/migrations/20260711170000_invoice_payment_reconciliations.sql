-- Payment-level Stripe reconciliation for gross/net paid revenue reporting

create table if not exists public.invoice_payment_reconciliations (
  id uuid primary key default gen_random_uuid(),

  invoice_id uuid not null references public.invoices(id) on delete cascade,

  provider text not null default 'stripe',

  external_invoice_payment_id text,
  external_payment_intent_id text,
  external_charge_id text,
  external_balance_transaction_id text,

  payment_type text,
  paid_at timestamptz not null,
  reporting_month text not null,

  original_currency text not null,
  original_amount_minor bigint not null,

  settlement_currency text,
  settlement_gross_minor bigint,
  stripe_fee_minor bigint,
  settlement_net_minor bigint,
  stripe_exchange_rate numeric(18,8),

  reference_rate_to_eur numeric(18,8),
  reference_rate_date date,
  reference_eur_minor bigint,

  gross_eur_minor bigint,
  stripe_fee_eur_minor bigint,
  net_eur_minor bigint,

  amount_basis text not null,
  is_paid_out_of_band boolean not null default false,

  fee_details jsonb not null default '[]'::jsonb,
  sync_status text not null default 'synced',
  sync_error text,
  metadata jsonb not null default '{}'::jsonb,

  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoice_payment_reconciliations_amount_basis_check
    check (amount_basis in (
      'stripe_actual_settlement',
      'native_eur',
      'ecb_reference',
      'paid_out_of_band_reference',
      'unavailable'
    )),

  constraint invoice_payment_reconciliations_sync_status_check
    check (sync_status in ('synced', 'partial', 'failed', 'unavailable'))
);

create unique index if not exists idx_invoice_payment_recon_invoice_payment
  on public.invoice_payment_reconciliations (invoice_id, external_invoice_payment_id)
  where external_invoice_payment_id is not null;

create unique index if not exists idx_invoice_payment_recon_invoice_charge
  on public.invoice_payment_reconciliations (invoice_id, external_charge_id)
  where external_charge_id is not null;

create index if not exists idx_invoice_payment_recon_reporting_month
  on public.invoice_payment_reconciliations (reporting_month, paid_at desc);

create index if not exists idx_invoice_payment_recon_invoice_id
  on public.invoice_payment_reconciliations (invoice_id);

drop trigger if exists trg_invoice_payment_reconciliations_updated_at on public.invoice_payment_reconciliations;
create trigger trg_invoice_payment_reconciliations_updated_at
  before update on public.invoice_payment_reconciliations
  for each row execute function public.set_updated_at();

alter table public.invoice_payment_reconciliations enable row level security;

drop policy if exists "invoice_payment_reconciliations_select_super_admin" on public.invoice_payment_reconciliations;
create policy "invoice_payment_reconciliations_select_super_admin"
  on public.invoice_payment_reconciliations
  for select to authenticated
  using (public.is_super_admin() and public.is_team_member());

drop policy if exists "invoice_payment_reconciliations_write_super_admin" on public.invoice_payment_reconciliations;
create policy "invoice_payment_reconciliations_write_super_admin"
  on public.invoice_payment_reconciliations
  for all to authenticated
  using (public.is_super_admin() and public.is_team_member())
  with check (public.is_super_admin() and public.is_team_member());
