-- CRM People: durable review decisions + accept publication fixes
-- Supports idempotent accept, role-inbox company-inbox linking, and audit history.

create table if not exists public.crm_review_decisions (
  id uuid primary key default gen_random_uuid(),
  review_identity text not null,
  candidate_id uuid references public.crm_entity_candidates(id) on delete set null,
  candidate_type text not null default 'person_candidate',
  decision text not null,
  canonical_entity_id uuid,
  canonical_entity_type text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  reason text,
  source_evidence_ids text[] not null default '{}'::text[],
  operation_identity text not null,
  previous_status text,
  resulting_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint crm_review_decisions_decision_check check (decision in (
    'added_as_person',
    'matched_existing_person',
    'linked_as_company_inbox',
    'suppressed',
    'ignored',
    'merged',
    'kept_separate',
    'resolved_conflict'
  )),
  constraint crm_review_decisions_operation_identity_key unique (operation_identity)
);

create index if not exists idx_crm_review_decisions_identity
  on public.crm_review_decisions (review_identity);

create index if not exists idx_crm_review_decisions_entity
  on public.crm_review_decisions (canonical_entity_type, canonical_entity_id);

create index if not exists idx_crm_review_decisions_decided_at
  on public.crm_review_decisions (decided_at desc);

alter table public.crm_review_decisions enable row level security;

drop policy if exists crm_review_decisions_select on public.crm_review_decisions;
create policy crm_review_decisions_select
  on public.crm_review_decisions for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('super_admin', 'pm')
    )
  );

-- Repair A: accepted person candidates that are valid people but still stuck in review visibility
update public.contacts c
set
  data_quality_status = 'accepted',
  visibility_state = 'active',
  quality_reason = null,
  manually_confirmed = coalesce(c.manually_confirmed, true),
  updated_at = now()
from public.crm_entity_candidates cand
where cand.entity_type = 'person'
  and cand.status = 'accepted'
  and cand.created_entity_id = c.id
  and c.soft_deleted_at is null
  and c.archived_at is null
  and coalesce(c.is_role_inbox, false) = false
  and (
    c.visibility_state = 'needs_review'
    or c.data_quality_status = 'needs_review'
  );

-- Repair B: accepted contacts that are still flagged role-inbox — do not publish as People.
-- Keep them suppressed so they leave review without appearing in All contacts.
update public.contacts c
set
  data_quality_status = 'ignored',
  visibility_state = 'suppressed',
  is_role_inbox = true,
  role_inbox_label = coalesce(c.role_inbox_label, 'Company inbox'),
  quality_reason = 'linked_as_company_inbox',
  suppressed_at = coalesce(c.suppressed_at, now()),
  updated_at = now()
from public.crm_entity_candidates cand
where cand.entity_type = 'person'
  and cand.status = 'accepted'
  and cand.created_entity_id = c.id
  and c.soft_deleted_at is null
  and coalesce(c.is_role_inbox, false) = true
  and coalesce(c.quality_reason, '') not in ('linked_as_company_inbox', 'suppressed_in_review', 'ignored_in_review');

-- Repair: accepted candidates with matched_person_id but null created_entity_id
update public.crm_entity_candidates
set created_entity_id = matched_person_id,
    updated_at = now()
where entity_type = 'person'
  and status = 'accepted'
  and created_entity_id is null
  and matched_person_id is not null;

comment on table public.crm_review_decisions is
  'Durable CRM review decisions for accept/match/suppress/link-inbox actions; operation_identity enforces idempotency.';
