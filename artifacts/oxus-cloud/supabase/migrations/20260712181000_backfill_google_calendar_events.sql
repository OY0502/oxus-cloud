-- Backfill calendar_events from existing Google interaction evidence

INSERT INTO public.calendar_events (
  title,
  event_date,
  start_time,
  type,
  provider,
  external_id,
  external_calendar_id,
  connection_id,
  owner_user_id,
  organizer_email,
  attendee_emails,
  metadata
)
SELECT
  coalesce(gi.subject, 'Untitled meeting'),
  gi.occurred_at::date,
  CASE WHEN gi.occurred_at::text LIKE '%T%' THEN to_char(gi.occurred_at, 'HH24:MI') ELSE NULL END,
  'meeting',
  'google',
  split_part(gi.external_id, ':', 2),
  gi.metadata->>'calendar_id',
  gi.connection_id,
  gi.owner_user_id,
  gi.organizer_email,
  gi.attendee_emails,
  gi.metadata
FROM public.google_interactions gi
WHERE gi.interaction_type = 'calendar_event'
  AND split_part(gi.external_id, ':', 2) <> ''
  AND gi.metadata->>'calendar_id' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.calendar_events ce
    WHERE ce.provider = 'google'
      AND ce.connection_id = gi.connection_id
      AND ce.external_calendar_id = gi.metadata->>'calendar_id'
      AND ce.external_id = split_part(gi.external_id, ':', 2)
  );

-- Reset entity resolution so reconciliation can create CRM records
UPDATE public.google_interactions
SET processed_at = NULL, company_id = NULL, person_ids = '{}'::uuid[]
WHERE processed_at IS NOT NULL;
