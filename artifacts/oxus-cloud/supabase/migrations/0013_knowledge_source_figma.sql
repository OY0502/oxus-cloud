-- Allow Figma as a knowledge source type (additive, safe).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'project_knowledge_sources_source_type_check'
      and conrelid = 'public.project_knowledge_sources'::regclass
  ) then
    alter table public.project_knowledge_sources
      drop constraint project_knowledge_sources_source_type_check;
  end if;

  alter table public.project_knowledge_sources
    add constraint project_knowledge_sources_source_type_check
    check (source_type in (
      'manual', 'uploaded_file', 'zoom_transcript', 'project_description',
      'figma', 'clickup', 'slack', 'other'
    ));
end $$;
