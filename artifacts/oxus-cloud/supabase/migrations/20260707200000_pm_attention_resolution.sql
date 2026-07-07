-- PM Attention item resolution: allow questions to be automatically resolved when
-- new context answers them, while preserving history (never deleted).

-- ---------------------------------------------------------------------------
-- Add resolution fields
-- ---------------------------------------------------------------------------
alter table public.project_pm_attention_items
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolution_summary text,
  add column if not exists resolution_evidence text,
  add column if not exists resolution_source_ids uuid[] not null default '{}'::uuid[],
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Allow the new 'resolved' status
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'project_pm_attention_items_status_check'
      and conrelid = 'public.project_pm_attention_items'::regclass
  ) then
    alter table public.project_pm_attention_items
      drop constraint project_pm_attention_items_status_check;
  end if;

  alter table public.project_pm_attention_items
    add constraint project_pm_attention_items_status_check
    check (status in ('open', 'answered', 'skipped', 'cleared', 'resolved'));
end $$;

-- Keep updated_at fresh on any change.
create or replace function public.set_pm_attention_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pm_attention_updated_at on public.project_pm_attention_items;
create trigger trg_pm_attention_updated_at
  before update on public.project_pm_attention_items
  for each row execute function public.set_pm_attention_updated_at();
