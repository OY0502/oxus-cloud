-- Manual invoice lifecycle stays entirely in OXUS and never calls Stripe.
create or replace function public.create_manual_invoice_v2(p_input jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_id uuid := (p_input->>'id')::uuid;
  v_status text := lower(coalesce(nullif(p_input->>'status', ''), 'draft'));
  v_paid_date date := nullif(p_input->>'paid_date', '')::date;
begin
  if v_status not in ('draft', 'sent', 'paid') then
    raise exception 'Manual invoices can be created as draft, sent, or paid.';
  end if;
  v_result := public.create_manual_invoice(p_input);
  if v_status = 'paid' then
    v_paid_date := coalesce(v_paid_date, (p_input->>'issue_date')::date, current_date);
    update public.invoices set
      status = 'paid', amount_paid = total, amount_due = 0,
      amount_paid_eur = case when upper(currency) = 'EUR' then total else amount_paid_eur end,
      amount_due_eur = case when upper(currency) = 'EUR' then 0 else amount_due_eur end,
      paid_date = v_paid_date, paid_at = v_paid_date::timestamptz,
      payment_method = 'manual'
    where id = v_id and provider = 'manual';
  elsif v_status = 'sent' then
    update public.invoices set status = 'sent' where id = v_id and provider = 'manual';
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_manual_invoice_v2(jsonb) from public, anon;
grant execute on function public.create_manual_invoice_v2(jsonb) to authenticated;

create or replace function public.update_manual_invoice_status(
  p_invoice_id uuid,
  p_action text,
  p_paid_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_action text := lower(p_action);
  v_paid date := coalesce(p_paid_date, current_date);
begin
  if auth.uid() is null or public.is_super_admin() is not true or public.is_team_member() is not true then
    raise exception 'Only an authorized administrator can update invoices.' using errcode = '42501';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if v_invoice.provider <> 'manual' then raise exception 'This action is only available for manual invoices.'; end if;

  if v_action = 'mark_paid' then
    update public.invoices set
      status = 'paid', amount_paid = total, amount_due = 0,
      amount_paid_eur = case when upper(currency) = 'EUR' then total else amount_paid_eur end,
      amount_due_eur = case when upper(currency) = 'EUR' then 0 else amount_due_eur end,
      paid_date = v_paid, paid_at = v_paid::timestamptz, payment_method = 'manual',
      attention_dismissed_at = null, attention_dismissed_by = null, attention_dismiss_reason = null
    where id = p_invoice_id;
  elsif v_action = 'mark_sent' then
    update public.invoices set
      status = 'sent', amount_paid = 0, amount_due = total,
      amount_paid_eur = case when upper(currency) = 'EUR' then 0 else amount_paid_eur end,
      amount_due_eur = case when upper(currency) = 'EUR' then total else amount_due_eur end,
      paid_date = null, paid_at = null, payment_method = null,
      attention_dismissed_at = null, attention_dismissed_by = null, attention_dismiss_reason = null
    where id = p_invoice_id;
  elsif v_action = 'return_to_draft' then
    update public.invoices set
      status = 'draft', amount_paid = 0, amount_due = total,
      amount_paid_eur = case when upper(currency) = 'EUR' then 0 else amount_paid_eur end,
      amount_due_eur = case when upper(currency) = 'EUR' then total else amount_due_eur end,
      paid_date = null, paid_at = null, payment_method = null,
      attention_dismissed_at = null, attention_dismissed_by = null, attention_dismiss_reason = null
    where id = p_invoice_id;
  elsif v_action = 'void' then
    update public.invoices set
      status = 'void', amount_due = 0,
      amount_due_eur = case when upper(currency) = 'EUR' then 0 else amount_due_eur end,
      attention_dismissed_at = null, attention_dismissed_by = null, attention_dismiss_reason = null
    where id = p_invoice_id;
  else
    raise exception 'Unsupported manual invoice action.';
  end if;

  return jsonb_build_object(
    'id', p_invoice_id,
    'status', (select status from public.invoices where id = p_invoice_id),
    'message', case v_action
      when 'mark_paid' then 'Invoice marked paid.'
      when 'mark_sent' then 'Invoice marked sent.'
      when 'return_to_draft' then 'Invoice returned to draft.'
      when 'void' then 'Invoice voided.'
    end
  );
end;
$$;

revoke all on function public.update_manual_invoice_status(uuid, text, date) from public, anon;
grant execute on function public.update_manual_invoice_status(uuid, text, date) to authenticated;
