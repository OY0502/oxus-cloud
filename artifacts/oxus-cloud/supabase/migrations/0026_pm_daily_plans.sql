-- ---------------------------------------------------------------------------
-- PM daily plans (AI-generated cross-project PM focus for the day)
-- ---------------------------------------------------------------------------

create table if not exists public.pm_daily_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null default current_date,
  summary text,
  top_priorities text[] not null default '{}',
  project_focus jsonb not null default '[]'::jsonb,
  risks text[] not null default '{}',
  suggested_order text[] not null default '{}',
  raw_response jsonb,
  model text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pm_daily_plans_plan_date_created_by_unique unique (plan_date, created_by)
);

create index if not exists idx_pm_daily_plans_plan_date on public.pm_daily_plans (plan_date desc);
create index if not exists idx_pm_daily_plans_created_at on public.pm_daily_plans (created_at desc);

alter table public.pm_daily_plans enable row level security;

drop policy if exists "pm_daily_plans_team_all" on public.pm_daily_plans;
create policy "pm_daily_plans_team_all"
  on public.pm_daily_plans for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
