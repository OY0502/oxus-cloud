// Run with the path to an installed @electric-sql/pglite/dist/index.js.
// Uses an isolated in-memory Postgres; never connects to production.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.clients (id uuid primary key, name text);
  create table public.projects (id uuid primary key, name text, organization_id uuid, client_id uuid);
  create table public.team_members (id uuid primary key);
  create function auth.uid() returns uuid language sql as
    'select nullif(current_setting(''test.user_id'', true), '''')::uuid';
  create function public.is_super_admin() returns boolean language sql as
    'select current_setting(''test.admin'', true) = ''true''';
  create function public.is_team_member() returns boolean language sql as 'select true';
  create function public.set_updated_at() returns trigger language plpgsql as
    'begin new.updated_at := now(); return new; end';
`);
const base = await migration("0001_agency_os_schema.sql");
await db.exec(base.slice(base.indexOf("create table if not exists public.invoices ("), base.indexOf("-- calendar_events")));
const foundation = await migration("20260711130000_crm_finance_stripe_foundation.sql");
await db.exec(foundation.slice(foundation.indexOf("alter table public.invoices"), foundation.indexOf("-- expenses")));
await db.exec(await migration("20260711150000_invoice_amount_eur.sql"));
const fx = await migration("20260711160000_invoice_fx_reporting.sql");
await db.exec(fx.slice(0, fx.indexOf("create table if not exists public.fx_rates")));
await db.exec(await migration("20260907230000_manual_invoice_creation.sql"));

const user = "00000000-0000-4000-8000-000000000001";
const company = "00000000-0000-4000-8000-000000000002";
const project = "00000000-0000-4000-8000-000000000003";
await db.query("insert into auth.users values ($1)", [user]);
await db.query("insert into clients values ($1, 'Test client')", [company]);
await db.query("insert into projects values ($1, 'Test project', $2, $2)", [project, company]);
await db.query("select set_config('test.user_id', $1, false), set_config('test.admin', 'true', false)", [user]);
const input = {
  id: "00000000-0000-4000-8000-000000000010", company_id: company, project_id: project,
  currency: "EUR", issue_date: "2026-09-07", due_date: "2026-10-07", memo: "Internal memo",
  line_items: [{ description: "Work", quantity: 1.5, unit_amount: 99.99 }, { description: "Support", quantity: 2, unit_amount: 10.25 }],
};
const create = (value) => db.query("select public.create_manual_invoice($1::jsonb) as invoice", [JSON.stringify(value)]);
const first = await create(input);
assert.equal(first.rows[0].invoice.id, input.id);
const row = (await db.query("select * from invoices where id = $1", [input.id])).rows[0];
assert.equal(row.provider, "manual"); assert.equal(row.sync_status, "local");
assert.equal(row.stripe_status, null); assert.equal(row.external_id, null);
assert.equal(row.hosted_invoice_url, null); assert.equal(row.status, "draft");
assert.equal(Number(row.total), 170.49); assert.equal(Number(row.amount_due_eur), 170.49);
assert.equal(row.invoice_metadata.memo, "Internal memo");
assert.equal((await db.query("select count(*)::int as n from invoice_line_items")).rows[0].n, 2);
await create(input);
assert.equal((await db.query("select count(*)::int as n from invoices")).rows[0].n, 1);
assert.equal((await db.query("select count(*)::int as n from invoice_line_items")).rows[0].n, 2);

const next = { ...input, id: "00000000-0000-4000-8000-000000000011" };
await assert.rejects(create({ ...next, due_date: "2026-09-01" }), /Due date/);
await assert.rejects(create({ ...next, line_items: [{ description: "Bad", quantity: -1, unit_amount: 10 }] }), /positive/);
await db.exec(`create function reject_test_line() returns trigger language plpgsql as
  'begin if new.description = ''Reject test line'' then raise exception ''Test insert failure''; end if; return new; end';
  create trigger reject_test_line before insert on invoice_line_items for each row execute function reject_test_line();`);
await assert.rejects(create({ ...next, line_items: [{ description: "Reject test line", quantity: 1, unit_amount: 10 }] }), /Test insert failure/);
assert.equal((await db.query("select count(*)::int as n from invoices")).rows[0].n, 1, "Failed lines roll back the entire invoice");
await db.query("select set_config('test.admin', 'false', false)");
await assert.rejects(create(next), /authorized administrator/);
assert.equal((await db.query("select has_function_privilege('anon', 'public.create_manual_invoice(jsonb)', 'execute') as allowed")).rows[0].allowed, false);
console.log("Manual invoice SQL checks passed: local-only fields, totals, memo, atomic rollback, retries, validation, authorization.");
await db.close();
