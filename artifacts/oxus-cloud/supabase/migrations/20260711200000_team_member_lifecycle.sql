-- Team member deactivation timestamp + lifecycle audit support
alter table public.contacts
  add column if not exists deactivated_at timestamptz;

comment on column public.contacts.deactivated_at is
  'When person_status was set to inactive. Cleared on reactivation.';

-- Backfill existing inactive members
update public.contacts
set deactivated_at = coalesce(updated_at, created_at)
where person_status = 'inactive'
  and deactivated_at is null;
