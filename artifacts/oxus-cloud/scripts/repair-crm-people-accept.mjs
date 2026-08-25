/**
 * Dry-run / apply repair for CRM People accept visibility gaps.
 *
 * Usage (from artifacts/oxus-cloud):
 *   node --env-file=.env scripts/repair-crm-people-accept.mjs --dry-run
 *   node --env-file=.env scripts/repair-crm-people-accept.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const dryRun = !process.argv.includes("--apply");
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)");
  console.error("Available env keys:", Object.keys(process.env).filter((k) => /SUPABASE|SERVICE|VITE_SUPABASE/i.test(k)).join(", ") || "(none)");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

function classifyLocal(email) {
  if (!email || !email.includes("@")) return "unknown";
  const local = email.split("@")[0].toLowerCase().split("+")[0];
  const role = new Set([
    "hello", "hi", "info", "support", "sales", "billing", "accounting", "accounts",
    "team", "admin", "contact", "security", "mail", "noreply", "no-reply", "notifications",
  ]);
  if (role.has(local) || role.has(local.replace(/[._-]/g, ""))) return "role_inbox";
  if (/^(no[-_.]?reply|notifications?|mailer-daemon|bounce)/i.test(local)) return "automated_sender";
  return "person";
}

async function countSnapshot() {
  const [{ count: people }, { count: reviewPeople }, { count: roleInbox }, { count: accepted }, { data: acceptedRows }] = await Promise.all([
    admin.from("contacts").select("*", { count: "exact", head: true }).is("soft_deleted_at", null).is("archived_at", null),
    admin.from("contacts").select("*", { count: "exact", head: true }).or("visibility_state.eq.needs_review,data_quality_status.eq.needs_review").is("soft_deleted_at", null),
    admin.from("contacts").select("*", { count: "exact", head: true }).eq("is_role_inbox", true).is("soft_deleted_at", null),
    admin.from("crm_entity_candidates").select("*", { count: "exact", head: true }).eq("entity_type", "person").eq("status", "accepted"),
    admin.from("crm_entity_candidates").select("id, email, display_name, created_entity_id, matched_person_id").eq("entity_type", "person").eq("status", "accepted").limit(2000),
  ]);

  let acceptedWithoutMapping = 0;
  let acceptedHidden = 0;
  let acceptedRoleInbox = 0;
  for (const row of acceptedRows ?? []) {
    const personId = row.created_entity_id ?? row.matched_person_id;
    if (!personId) {
      acceptedWithoutMapping += 1;
      continue;
    }
    const { data: person } = await admin.from("contacts").select("visibility_state, data_quality_status, is_role_inbox").eq("id", personId).maybeSingle();
    if (!person) {
      acceptedWithoutMapping += 1;
      continue;
    }
    if (person.is_role_inbox) acceptedRoleInbox += 1;
    if (person.visibility_state === "needs_review" || person.data_quality_status === "needs_review") acceptedHidden += 1;
  }

  return {
    canonical_people: people ?? 0,
    needs_review_people: reviewPeople ?? 0,
    role_inbox_people: roleInbox ?? 0,
    accepted_person_candidates: accepted ?? 0,
    accepted_without_mapping: acceptedWithoutMapping,
    accepted_still_needs_review: acceptedHidden,
    accepted_role_inbox: acceptedRoleInbox,
  };
}

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLY ===");
  const before = await countSnapshot();
  console.log("Before:", before);

  const { data: accepted } = await admin
    .from("crm_entity_candidates")
    .select("*")
    .eq("entity_type", "person")
    .eq("status", "accepted")
    .limit(2000);

  let publishValid = 0;
  let suppressRole = 0;
  let mapCreated = 0;

  for (const cand of accepted ?? []) {
    const personId = cand.created_entity_id ?? cand.matched_person_id;
    if (!personId) continue;
    const { data: person } = await admin
      .from("contacts")
      .select("id, email, visibility_state, data_quality_status, is_role_inbox, quality_reason")
      .eq("id", personId)
      .maybeSingle();
    if (!person) continue;

    if (!cand.created_entity_id && cand.matched_person_id) {
      mapCreated += 1;
      if (!dryRun) {
        await admin.from("crm_entity_candidates").update({ created_entity_id: cand.matched_person_id }).eq("id", cand.id);
      }
    }

    const kind = person.is_role_inbox || classifyLocal(person.email ?? cand.email) === "role_inbox"
      ? "role_inbox"
      : "person";

    if (kind === "role_inbox") {
      if (person.quality_reason === "linked_as_company_inbox") continue;
      suppressRole += 1;
      if (!dryRun) {
        await admin.from("contacts").update({
          is_role_inbox: true,
          role_inbox_label: "Company inbox",
          data_quality_status: "ignored",
          visibility_state: "suppressed",
          quality_reason: "linked_as_company_inbox",
          suppressed_at: new Date().toISOString(),
        }).eq("id", person.id);
      }
      continue;
    }

    if (person.visibility_state === "needs_review" || person.data_quality_status === "needs_review") {
      publishValid += 1;
      if (!dryRun) {
        await admin.from("contacts").update({
          data_quality_status: "accepted",
          visibility_state: "active",
          is_role_inbox: false,
          role_inbox_label: null,
          quality_reason: null,
          manually_confirmed: true,
        }).eq("id", person.id);
      }
    }
  }

  console.log("Planned/applied:", { publishValid, suppressRole, mapCreated });
  const after = dryRun ? before : await countSnapshot();
  if (!dryRun) console.log("After:", after);
  console.log(dryRun ? "Re-run with --apply to write changes." : "Repair complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
