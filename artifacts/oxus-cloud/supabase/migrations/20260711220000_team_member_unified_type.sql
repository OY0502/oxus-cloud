-- Unify Team Member engagement: allow company_people.relationship_type = 'team_member'.
-- Legacy 'employee' / 'contractor' values remain valid for backward compatibility.
-- contacts.employment_type is preserved but no longer required by Team workflows.

alter table public.company_people drop constraint if exists company_people_relationship_type_check;
alter table public.company_people
  add constraint company_people_relationship_type_check
  check (relationship_type in (
    'team_member',
    'employee', 'contractor',
    'client_contact', 'decision_maker',
    'billing_contact', 'technical_contact', 'lead', 'partner', 'vendor_contact'
  ));
