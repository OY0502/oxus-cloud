-- Manual invoices are internal records. This transaction never calls a provider.
create or replace function public.create_manual_invoice(p_input jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := (p_input->>'id')::uuid;
  v_company uuid := (p_input->>'company_id')::uuid;
  v_project uuid := nullif(p_input->>'project_id', '')::uuid;
  v_client_name text;
  v_project_name text;
  v_project_company uuid;
  v_currency text := upper(coalesce(p_input->>'currency', 'EUR'));
  v_issue date := (p_input->>'issue_date')::date;
  v_due date := nullif(p_input->>'due_date', '')::date;
  v_line jsonb;
  v_quantity numeric;
  v_unit numeric;
  v_total numeric := 0;
  v_position integer := 0;
  v_existing public.invoices%rowtype;
begin
  if auth.uid() is null or public.is_super_admin() is not true or public.is_team_member() is not true then
    raise exception 'Only an authorized administrator can create invoices.' using errcode = '42501';
  end if;
  if v_id is null or v_company is null or v_issue is null then
    raise exception 'Invoice ID, client and issue date are required.';
  end if;
  -- Serialize retries using the same form ID without touching other invoices.
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  select * into v_existing from public.invoices where id = v_id;
  if found then
    if v_existing.provider <> 'manual' or v_existing.created_by is distinct from auth.uid() then
      raise exception 'Invoice ID is already in use.';
    end if;
    return jsonb_build_object('id', v_existing.id, 'number', v_existing.number);
  end if;
  if v_currency not in ('EUR', 'USD', 'GBP') then raise exception 'Unsupported currency.'; end if;
  if v_due < v_issue then raise exception 'Due date cannot be before the issue date.'; end if;
  select name into v_client_name from public.clients where id = v_company;
  if not found then raise exception 'Client not found.'; end if;
  if v_project is not null then
    select name, coalesce(organization_id, client_id) into v_project_name, v_project_company
      from public.projects where id = v_project;
    if not found then raise exception 'Project not found.'; end if;
    if v_project_company is not null and v_project_company <> v_company then
      raise exception 'The project belongs to another client.';
    end if;
  end if;
  if jsonb_typeof(p_input->'line_items') is distinct from 'array'
     or jsonb_array_length(p_input->'line_items') = 0 then
    raise exception 'Add at least one line item.';
  end if;
  for v_line in select value from jsonb_array_elements(p_input->'line_items') loop
    v_quantity := (v_line->>'quantity')::numeric;
    v_unit := (v_line->>'unit_amount')::numeric;
    if nullif(trim(v_line->>'description'), '') is null
       or v_quantity is null or v_quantity <= 0 or v_quantity >= 10000000000
       or v_unit is null or v_unit <= 0 or v_unit >= 10000000000
       or v_quantity <> round(v_quantity, 2) or v_unit <> round(v_unit, 2) then
      raise exception 'Each line requires a description and positive quantity and unit amount with at most two decimal places.';
    end if;
    v_total := v_total + round(v_quantity * v_unit, 2);
  end loop;
  if v_total <= 0 or v_total >= 10000000000 then raise exception 'Invoice total is out of range.'; end if;
  insert into public.invoices (
    id, number, client_id, client_name, project_id, project, currency, issue_date, due_date,
    issued_at, due_at, provider, stripe_status, sync_status, status,
    amount, subtotal, total, amount_due, amount_paid, tax_amount, created_by, invoice_metadata,
    amount_eur, subtotal_eur, amount_due_eur, amount_paid_eur, tax_amount_eur,
    fx_status, fx_rate_to_eur, fx_rate_date
  ) values (
    v_id, coalesce(nullif(trim(p_input->>'number'), ''), 'MAN-' || upper(v_id::text)),
    v_company, v_client_name, v_project, v_project_name, v_currency, v_issue, v_due,
    v_issue::timestamptz, v_due::timestamptz, 'manual', null, 'local', 'draft',
    v_total, v_total, v_total, v_total, 0, 0, auth.uid(),
    jsonb_build_object('memo', coalesce(p_input->>'memo', '')),
    case when v_currency = 'EUR' then v_total end,
    case when v_currency = 'EUR' then v_total end,
    case when v_currency = 'EUR' then v_total end,
    case when v_currency = 'EUR' then 0 end,
    case when v_currency = 'EUR' then 0 end,
    case when v_currency = 'EUR' then 'native_eur' else 'pending' end,
    case when v_currency = 'EUR' then 1 end,
    case when v_currency = 'EUR' then v_issue end
  );
  for v_line in select value from jsonb_array_elements(p_input->'line_items') loop
    v_quantity := (v_line->>'quantity')::numeric;
    v_unit := (v_line->>'unit_amount')::numeric;
    insert into public.invoice_line_items (invoice_id, description, quantity, unit_amount, amount, line_total, position)
      values (v_id, trim(v_line->>'description'), v_quantity, v_unit,
        round(v_quantity * v_unit, 2), round(v_quantity * v_unit, 2), v_position);
    v_position := v_position + 1;
  end loop;
  return jsonb_build_object('id', v_id, 'number', (select number from public.invoices where id = v_id));
end;
$$;

revoke all on function public.create_manual_invoice(jsonb) from public, anon;
grant execute on function public.create_manual_invoice(jsonb) to authenticated;
