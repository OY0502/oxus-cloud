-- Project cover image stored in Supabase Storage (path only; signed URLs at read time).
alter table public.projects
  add column if not exists image_path text;
