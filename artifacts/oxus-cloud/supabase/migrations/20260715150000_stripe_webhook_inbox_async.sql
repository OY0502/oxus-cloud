-- Stripe webhook inbox: durable storage + async processing metadata

alter table public.stripe_webhook_events
  add column if not exists provider text not null default 'stripe',
  add column if not exists livemode boolean,
  add column if not exists api_version text,
  add column if not exists object_id text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists received_at timestamptz not null default now();

update public.stripe_webhook_events
set received_at = created_at
where received_at is null;

create index if not exists idx_stripe_webhook_events_status_received
  on public.stripe_webhook_events (status, received_at desc);

create index if not exists idx_stripe_webhook_events_pending
  on public.stripe_webhook_events (status)
  where status in ('received', 'pending', 'processing', 'failed');

alter table public.stripe_integration_state
  add column if not exists webhook_last_processed_at timestamptz,
  add column if not exists webhook_last_event_id text,
  add column if not exists webhook_endpoint_url text;

update public.stripe_integration_state
set webhook_endpoint_url = 'https://xyphlqyujifneqqtzmto.supabase.co/functions/v1/stripe-webhook'
where webhook_endpoint_url is null;
