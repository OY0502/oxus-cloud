/**
 * Production CRM data audit (service role). Does not print secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      if (!process.env[key]) {
        process.env[key] = m[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("MISSING_ENV: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const SUSPICIOUS_NAMES = /^(hello|verify|mail|googlecloud|masaljovana118|infoportugaltravel)$/i;

const { data: companies, error: ce } = await sb
  .from("clients")
  .select("id, name, company_type, data_quality_status, manually_confirmed, source, registrable_domain, primary_domain, last_interaction_at, needs_review")
  .is("archived_at", null);

if (ce) {
  console.error("companies_err", ce.message);
  process.exit(1);
}

const { data: people, error: pe } = await sb
  .from("contacts")
  .select("id, name, email, data_quality_status, is_role_inbox, manually_confirmed, source, last_interaction_at, client_id")
  .is("archived_at", null);

if (pe) {
  console.error("people_err", pe.message);
  process.exit(1);
}

function tally(rows, key) {
  const out = {};
  for (const r of rows) {
    const v = r[key] ?? "null";
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}

const manualCompanies = companies.filter((c) => c.manually_confirmed).length;
const manualPeople = people.filter((p) => p.manually_confirmed).length;
const importedCompanies = companies.filter((c) => (c.source ?? "").toLowerCase().includes("google")).length;
const importedPeople = people.filter((p) => (p.source ?? "").toLowerCase().includes("google")).length;

const suspiciousPeople = people.filter((p) =>
  SUSPICIOUS_NAMES.test(p.name ?? "") || /failed.?payment/i.test(p.name ?? "") || /^\d{5,}$/.test(p.name ?? "")
);

const platformDomains = ["google.com", "stripe.com", "hubspot.com", "bubble.io", "retool.com", "firecrawl.dev", "upwork.com", "vercel.com"];
const infraCompanies = companies.filter((c) => {
  const d = (c.registrable_domain ?? c.primary_domain ?? "").toLowerCase();
  return platformDomains.some((p) => d === p || d.endsWith("." + p));
});

const activeVisiblePeople = people.filter((p) => p.data_quality_status === "accepted" && !p.is_role_inbox);
const activeVisibleCompanies = companies.filter((c) => c.data_quality_status === "accepted");

console.log(JSON.stringify({
  before: {
    total_people: people.length,
    total_companies: companies.length,
    manual_people: manualPeople,
    manual_companies: manualCompanies,
    imported_people: importedPeople,
    imported_companies: importedCompanies,
    people_quality: tally(people, "data_quality_status"),
    company_quality: tally(companies, "data_quality_status"),
    company_types: tally(companies, "company_type"),
    active_clients: companies.filter((c) => c.company_type === "client" && c.data_quality_status === "accepted").length,
    role_inboxes: people.filter((p) => p.is_role_inbox).length,
    people_no_interaction: people.filter((p) => !p.last_interaction_at).length,
    companies_no_interaction: companies.filter((c) => !c.last_interaction_at).length,
    needs_review_people: people.filter((p) => p.data_quality_status === "needs_review").length,
    needs_review_companies: companies.filter((c) => c.data_quality_status === "needs_review" || c.needs_review).length,
    suspicious_visible: suspiciousPeople.filter((p) => p.data_quality_status === "accepted").length,
    infra_as_client: infraCompanies.filter((c) => c.company_type === "client").map((c) => c.name),
    suspicious_people_sample: suspiciousPeople.slice(0, 12).map((p) => ({
      name: p.name,
      email: p.email,
      status: p.data_quality_status,
    })),
  },
}, null, 2));
