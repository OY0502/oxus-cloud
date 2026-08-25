-- Extend invoice status for Stripe terminal states and backfill misclassified rows.

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN (
    'draft', 'sent', 'viewed', 'partial', 'overdue', 'paid', 'uncollectible', 'void'
  ));

-- Stripe uncollectible invoices were incorrectly normalized to overdue.
UPDATE public.invoices
SET status = 'uncollectible'
WHERE provider = 'stripe'
  AND stripe_status = 'uncollectible'
  AND status <> 'uncollectible';

-- Stripe void invoices were incorrectly normalized to draft/overdue/sent.
UPDATE public.invoices
SET status = 'void'
WHERE provider = 'stripe'
  AND stripe_status = 'void'
  AND status <> 'void';
