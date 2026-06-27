-- =============================================================================
-- Polymorphic collaboration entities shared by quotes and projects:
-- comments, tasks, and attachments (documents). Keyed by (entity_type, entity_id)
-- where entity_type in ('quote', 'project').
-- =============================================================================

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('quote', 'project')),
  entity_id   uuid not null,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_comments_entity on public.comments (entity_type, entity_id);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('quote', 'project')),
  entity_id   uuid not null,
  title       text not null,
  status      text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date    date,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_tasks_entity on public.tasks (entity_type, entity_id);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('quote', 'project')),
  entity_id   uuid not null,
  doc_type    text not null default 'attachment'
                check (doc_type in ('attachment', 'msa', 'nda', 'sow', 'other')),
  is_active   boolean not null default true,
  file_path   text not null,
  file_name   text not null,
  file_size   bigint,
  mime_type   text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_attachments_entity on public.attachments (entity_type, entity_id);
