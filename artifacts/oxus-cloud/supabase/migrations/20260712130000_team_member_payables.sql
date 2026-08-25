-- Team Member payables — accrued compensation owed by OXUS (separate from contractor invoices).

-- ---------------------------------------------------------------------------
-- team_member_payables
-- ---------------------------------------------------------------------------
create table if not exists public.team_member_payables (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.contacts(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  client_invoice_id uuid references public.invoices(id) on delete set null,
  contractor_invoice_id uuid references public.contractor_invoices(id) on delete set null,

  title text,
  description text,
  work_type text,

  calculation_basis text not null default 'manual',
  source_rate_id uuid references public.team_member_rates(id) on delete set null,
  quantity numeric(14,4),
  unit_amount numeric(14,4),
  unit_currency text,
  percentage numeric(8,4),

  currency text not null default 'EUR',
  amount numeric(14,2) not null,
  amount_eur numeric(14,2),
  fx_rate_to_eur numeric(18,8),
  fx_rate_date date,
  fx_rate_source text,
  fx_status text,

  period_start date,
  period_end date,
  due_date date,

  approval_status text not null default 'draft',
  release_condition text not null default 'immediate',
  released_at timestamptz,
  needs_review boolean not null default false,

  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,

  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_team_member_payables_person on public.team_member_payables (person_id);
create index if not exists idx_team_member_payables_project on public.team_member_payables (project_id);
create index if not exists idx_team_member_payables_client_invoice on public.team_member_payables (client_invoice_id);
create index if not exists idx_team_member_payables_approval on public.team_member_payables (approval_status);
create index if not exists idx_team_member_payables_due_date on public.team_member_payables (due_date);

alter table public.team_member_payables drop constraint if exists team_member_payables_calculation_basis_check;
alter table public.team_member_payables
  add constraint team_member_payables_calculation_basis_check
  check (calculation_basis in ('manual', 'hours_x_rate', 'days_x_rate', 'percentage_of_client_invoice', 'fixed_project'));

alter table public.team_member_payables drop constraint if exists team_member_payables_approval_status_check;
alter table public.team_member_payables
  add constraint team_member_payables_approval_status_check
  check (approval_status in ('draft', 'approved', 'cancelled'));

alter table public.team_member_payables drop constraint if exists team_member_payables_release_condition_check;
alter table public.team_member_payables
  add constraint team_member_payables_release_condition_check
  check (release_condition in ('immediate', 'when_client_invoice_paid', 'manual'));

drop trigger if exists trg_team_member_payables_updated_at on public.team_member_payables;
create trigger trg_team_member_payables_updated_at
  before update on public.team_member_payables
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- team_member_payable_payments — link payouts to payables
-- ---------------------------------------------------------------------------
create table if not exists public.team_member_payable_payments (
  id uuid primary key default gen_random_uuid(),
  payable_id uuid not null references public.team_member_payables(id) on delete cascade,
  payout_id uuid not null references public.payouts(id) on delete cascade,
  allocated_amount numeric(14,2) not null,
  allocated_amount_eur numeric(14,2),
  created_at timestamptz not null default now(),
  unique(payable_id, payout_id)
);

create index if not exists idx_team_member_payable_payments_payable
  on public.team_member_payable_payments (payable_id);
create index if not exists idx_team_member_payable_payments_payout
  on public.team_member_payable_payments (payout_id);

-- ---------------------------------------------------------------------------
-- RLS — super_admin only
-- ---------------------------------------------------------------------------
alter table public.team_member_payables enable row level security;
alter table public.team_member_payable_payments enable row level security;

drop policy if exists team_member_payables_all on public.team_member_payables;
create policy team_member_payables_all on public.team_member_payables
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists team_member_payable_payments_all on public.team_member_payable_payments;
create policy team_member_payable_payments_all on public.team_member_payable_payments
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Release payables when linked client invoice is paid / flag for review
-- ---------------------------------------------------------------------------
create or replace function public.process_client_invoice_payable_release(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice record;
  v_released int := 0;
  v_flagged int := 0;
begin
  select id, status into v_invoice
  from public.invoices
  where id = p_invoice_id;

  if not found then
    return jsonb_build_object('released', 0, 'flagged', 0);
  end if;

  if v_invoice.status = 'paid' then
    update public.team_member_payables
    set
      released_at = coalesce(released_at, now()),
      needs_review = false,
      updated_at = now()
    where client_invoice_id = p_invoice_id
      and approval_status = 'approved'
      and release_condition = 'when_client_invoice_paid'
      and released_at is null;
    get diagnostics v_released = row_count;
  elsif v_invoice.status in ('void', 'uncollectible') then
    update public.team_member_payables
    set
      needs_review = true,
      updated_at = now()
    where client_invoice_id = p_invoice_id
      and approval_status = 'approved'
      and release_condition = 'when_client_invoice_paid'
      and released_at is null;
    get diagnostics v_flagged = row_count;
  end if;

  return jsonb_build_object('released', v_released, 'flagged', v_flagged);
end;
$$;

create or replace function public.trg_invoices_payable_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (old.status is distinct from new.status) then
    perform public.process_client_invoice_payable_release(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_payable_release on public.invoices;
create trigger trg_invoices_payable_release
  after update of status on public.invoices
  for each row execute function public.trg_invoices_payable_release();

-- ---------------------------------------------------------------------------
-- Reconciliation view: payouts without payable allocations
-- ---------------------------------------------------------------------------
create or replace view public.unallocated_payouts_report as
select
  p.id as payout_id,
  p.person_id,
  p.amount,
  p.currency,
  p.payment_date,
  p.status,
  coalesce(alloc.payable_allocated, 0) as payable_allocated,
  coalesce(inv_alloc.invoice_allocated, 0) as invoice_allocated,
  p.amount - coalesce(alloc.payable_allocated, 0) - coalesce(inv_alloc.invoice_allocated, 0) as unallocated_amount
from public.payouts p
left join (
  select payout_id, sum(allocated_amount) as payable_allocated
  from public.team_member_payable_payments
  group by payout_id
) alloc on alloc.payout_id = p.id
left join (
  select payout_id, sum(allocated_amount) as invoice_allocated
  from public.contractor_invoice_payments
  group by payout_id
) inv_alloc on inv_alloc.payout_id = p.id
where p.status = 'paid'
  and p.amount - coalesce(alloc.payable_allocated, 0) - coalesce(inv_alloc.invoice_allocated, 0) > 0.01;

revoke all on public.unallocated_payouts_report from anon, authenticated;
grant select on public.unallocated_payouts_report to authenticated;
