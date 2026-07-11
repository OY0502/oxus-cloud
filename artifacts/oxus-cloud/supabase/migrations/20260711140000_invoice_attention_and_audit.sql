-- Invoice attention dismissal + action audit log

alter table public.invoices
  add column if not exists attention_dismissed_at timestamptz,
  add column if not exists attention_dismissed_by uuid references public.profiles(id) on delete set null,
  add column if not exists attention_dismiss_reason text;

-- Backfill amount from total where Stripe sync wrote total but amount stayed 0
update public.invoices
set amount = total
where (amount is null or amount = 0) and coalesce(total, 0) > 0;

create table if not exists public.invoice_action_logs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  external_id text,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  previous_stripe_status text,
  resulting_stripe_status text,
  success boolean not null default true,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_action_logs_invoice on public.invoice_action_logs (invoice_id);
create index if not exists idx_invoice_action_logs_created on public.invoice_action_logs (created_at desc);

alter table public.invoice_action_logs enable row level security;

drop policy if exists invoice_action_logs_select on public.invoice_action_logs;
create policy invoice_action_logs_select on public.invoice_action_logs
  for select to authenticated using (public.is_super_admin());

drop policy if exists invoice_action_logs_insert on public.invoice_action_logs;
create policy invoice_action_logs_insert on public.invoice_action_logs
  for insert to authenticated with check (public.is_super_admin());

-- Attention dismissal: super_admin only (via edge functions / admin mutations)
drop policy if exists invoices_attention_dismiss on public.invoices;
-- Existing invoice RLS from prior migrations handles super_admin; no change needed for update.
