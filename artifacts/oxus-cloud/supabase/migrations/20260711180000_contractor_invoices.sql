-- Contractor invoices (accounts payable) — separate from client receivables (invoices table).

-- ---------------------------------------------------------------------------
-- contractor_invoices
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_invoices (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.contacts(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,

  invoice_number text,
  invoice_date date not null,
  due_date date,

  currency text not null default 'EUR',
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null,

  status text not null default 'received',
  source text not null default 'manual',

  external_id text,
  external_url text,
  file_path text,

  description text,
  period_start date,
  period_end date,

  paid_amount numeric(14,2) not null default 0,
  paid_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contractor_invoices_person on public.contractor_invoices (person_id);
create index if not exists idx_contractor_invoices_project on public.contractor_invoices (project_id);
create index if not exists idx_contractor_invoices_status on public.contractor_invoices (status);
create index if not exists idx_contractor_invoices_due_date on public.contractor_invoices (due_date);
create index if not exists idx_contractor_invoices_invoice_date on public.contractor_invoices (invoice_date);

drop trigger if exists trg_contractor_invoices_updated_at on public.contractor_invoices;
create trigger trg_contractor_invoices_updated_at
  before update on public.contractor_invoices
  for each row execute function public.set_updated_at();

alter table public.contractor_invoices drop constraint if exists contractor_invoices_status_check;
alter table public.contractor_invoices
  add constraint contractor_invoices_status_check
  check (status in ('received', 'approved', 'partially_paid', 'paid', 'disputed', 'cancelled'));

alter table public.contractor_invoices drop constraint if exists contractor_invoices_source_check;
alter table public.contractor_invoices
  add constraint contractor_invoices_source_check
  check (source in ('manual', 'uploaded_file', 'wise', 'email', 'other'));

-- ---------------------------------------------------------------------------
-- contractor_invoice_payments — link payouts to invoices
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  contractor_invoice_id uuid not null
    references public.contractor_invoices(id) on delete cascade,
  payout_id uuid not null
    references public.payouts(id) on delete cascade,
  allocated_amount numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique(contractor_invoice_id, payout_id)
);

create index if not exists idx_contractor_invoice_payments_invoice
  on public.contractor_invoice_payments (contractor_invoice_id);
create index if not exists idx_contractor_invoice_payments_payout
  on public.contractor_invoice_payments (payout_id);

-- ---------------------------------------------------------------------------
-- Sync invoice paid_amount and status from payment allocations
-- ---------------------------------------------------------------------------
create or replace function public.sync_contractor_invoice_payment_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_allocated numeric(14,2);
  v_current_status text;
begin
  select total, status into v_total, v_current_status
  from public.contractor_invoices
  where id = p_invoice_id;

  if not found then
    return;
  end if;

  if v_current_status in ('cancelled', 'disputed') then
    return;
  end if;

  select coalesce(sum(allocated_amount), 0) into v_allocated
  from public.contractor_invoice_payments
  where contractor_invoice_id = p_invoice_id;

  update public.contractor_invoices
  set
    paid_amount = v_allocated,
    paid_at = case
      when v_allocated >= v_total then coalesce(paid_at, now())
      else null
    end,
    status = case
      when v_current_status in ('cancelled', 'disputed') then v_current_status
      when v_allocated >= v_total then 'paid'
      when v_allocated > 0 then 'partially_paid'
      when v_current_status = 'partially_paid' and v_allocated = 0 then 'approved'
      else v_current_status
    end,
    updated_at = now()
  where id = p_invoice_id;
end;
$$;

create or replace function public.trg_sync_contractor_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_contractor_invoice_payment_status(
    coalesce(new.contractor_invoice_id, old.contractor_invoice_id)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_contractor_invoice_payments_sync on public.contractor_invoice_payments;
create trigger trg_contractor_invoice_payments_sync
  after insert or update or delete on public.contractor_invoice_payments
  for each row execute function public.trg_sync_contractor_invoice_payment_status();

-- ---------------------------------------------------------------------------
-- RLS — super_admin only (financial payables)
-- ---------------------------------------------------------------------------
alter table public.contractor_invoices enable row level security;
alter table public.contractor_invoice_payments enable row level security;

drop policy if exists contractor_invoices_all on public.contractor_invoices;
create policy contractor_invoices_all on public.contractor_invoices
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists contractor_invoice_payments_all on public.contractor_invoice_payments;
create policy contractor_invoice_payments_all on public.contractor_invoice_payments
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Private storage bucket for contractor invoice documents
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contractor-invoices',
  'contractor-invoices',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

drop policy if exists contractor_invoices_storage_all on storage.objects;
create policy contractor_invoices_storage_all on storage.objects
  for all to authenticated
  using (bucket_id = 'contractor-invoices' and public.is_super_admin())
  with check (bucket_id = 'contractor-invoices' and public.is_super_admin());
