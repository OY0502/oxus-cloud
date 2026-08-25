# Legacy Code Inventory

Repository stabilization pass (2026-07-14). Classifications guide the upcoming CRM identity-graph / resolver v2 cutover.

## Repository layout

| Path | Role | Status |
|------|------|--------|
| `e:\Code Projects\oxus-cloud` | Git root, pnpm workspace, Vercel project root | **Active** |
| `artifacts/oxus-cloud` | Production Vite app, Supabase project, Trigger.dev tasks | **Active** |
| `lib/*` | Shared API spec, DB schema, client codegen (Replit template) | **Active for codegen** |
| `artifacts/api-server` | Express API from template | **Deprecated but retained** — not used by production frontend |
| `artifacts/mockup-sandbox` | Replit UI sandbox | **Deprecated but retained** — requires `PORT` env; excluded from production build |
| `scripts/` | Workspace maintenance scripts | **Active** |

Open the **monorepo root** (`oxus-cloud/`), not `artifacts/oxus-cloud/` alone, in VS Code/Cursor.

## Safe to delete now

Nothing removed in this pass beyond documentation and tooling fixes. No zero-reference production modules were found with high confidence.

| Stray root `trigger.config.ts` + `src/trigger/example.ts` | Repo root | **Deleted** — scaffold from wrong-directory `trigger.dev init` |

## Still active (production)

### Application

- `artifacts/oxus-cloud/src/**` — Vite SPA deployed to https://oxus.cloud
- `artifacts/oxus-cloud/supabase/functions/**` — Edge Functions (auth, CRM, Google, Stripe, ClickUp, Slack)
- `artifacts/oxus-cloud/src/trigger/**` — Trigger.dev tasks (Google sync, CRM, agents, invoices)
- `vercel.json` — production frontend build (`pnpm --filter @workspace/oxus-cloud run build`)

### CRM (current writers — do not remove before v2 cutover)

| Area | Location | Notes |
|------|----------|-------|
| Gmail-first entity resolution | `supabase/functions/_shared/crmEntityResolution.ts` | Active writer during Google import |
| Google CRM batch processing | `supabase/functions/_shared/crmGoogleEntityProcessing.ts` | Active |
| CRM handler wrapper | `supabase/functions/_shared/crmHandler.ts` | Active for import candidate APIs |
| Import quality reconcile | `supabase/functions/_shared/crmImportQualityReconcile.ts` | Active; queues logos |
| Logo resolution | `supabase/functions/resolve-company-logo/`, `src/trigger/index.ts` (`resolve-company-logo`) | Active |
| Company enrichment | `supabase/functions/crm-enrich-company/` | Active |
| Client-side CRM helpers | `src/lib/crm/**` | Active UI + tests; mirrors edge shared logic |

### Google import pipeline

- `supabase/functions/_shared/googleCrmCoreSync.ts` — fast core sync
- `supabase/functions/_shared/googleSyncBatch.ts`, `googleSyncWorker.ts` — batch workers
- `src/trigger/googleSyncTasks.ts`, `googleOrchestrator.ts` — Trigger.dev orchestration
- `supabase/functions/_shared/googleImportReconcile.ts` — post-import reconcile

### Operational scripts (retained)

- `artifacts/oxus-cloud/scripts/audit-crm-production.mjs`
- `artifacts/oxus-cloud/scripts/run-crm-reconcile*.mjs`
- `artifacts/oxus-cloud/scripts/run-crm-v2-migration.mjs`
- `artifacts/oxus-cloud/scripts/run-google-import-worker.mjs`
- `artifacts/oxus-cloud/scripts/list-google-import-runs.mjs`
- `artifacts/oxus-cloud/scripts/test-google-incremental-sync.mjs`

## Deprecated but required temporarily

| Item | Location | Reason |
|------|----------|--------|
| `crmEntityResolution.ts` v1 rules | `supabase/functions/_shared/` | Still writes Person/Company during import |
| Default Client classification | `relationshipClassification.ts` (shared + `src/lib/crm`) | Production data depends on current defaults |
| `resolve-company-logo` task + queue | Trigger + edge function | Logo backfill still queued from reconcile |
| `reconcile-crm-import-quality` | Trigger + edge function | Operational quality pass |
| `crm-resolver-stage` / `crm-migrate-v2` tasks | `src/trigger/index.ts` | v2 migration hooks; not yet primary writer |
| Duplicate CRM shared modules | `src/lib/crm/*` ↔ `supabase/functions/_shared/crm/*` | Intentional mirror for Deno edge vs Vite; consolidate during v2 |
| `artifacts/api-server` | `artifacts/api-server/` | Template artifact; production uses Supabase |
| `artifacts/mockup-sandbox` | `artifacts/mockup-sandbox/` | Replit sandbox only |

## Replace during CRM resolver v2 migration

| Area | Current | Target |
|------|---------|--------|
| Person creation from Gmail | `crmEntityResolution.ts` email-first | `crmIdentity/pipeline.ts` evidence graph |
| Company name inference | `companyNaming.ts`, `crmEntityResolution.ts` | Identity resolver v2 + evidence ingest |
| Canonical writers | Multiple paths (Google batch, reconcile, manual CRM) | Single resolver pipeline |
| `crm-resolver-worker` edge function | Staging/migration actions | Primary post-import writer |
| Compatibility views | DB migrations `crm_identity_resolution_v2`, `crm_quality_foundation` | Retire adapters after cutover |
| Logo queue from reconcile | `crmImportQualityReconcile.ts` | Resolver-owned enrichment queue |

## Requires manual verification

| Item | Notes |
|------|-------|
| Empty migration placeholders | `20260628214618_pm_action_dismissal_suppression.sql`, `20260713090737_google_core_enrichment_split.sql` — no-op; confirm applied in prod before removing versions |
| `lib/db` Drizzle schema | May drift from Supabase migrations; production DB is source of truth |
| Trigger.dev task IDs | 30+ tasks registered; verify dashboard matches `src/trigger/` after deploy |
| `api-server` package | No imports from oxus-cloud; confirm Replit still needs it |

## Migration hygiene notes

- **81** SQL migrations under `artifacts/oxus-cloud/supabase/migrations/`
- Duplicate topic migrations exist (empty timestamped stubs + numbered/full versions) — retained for history
- Do not rewrite applied migrations; add corrective migrations only

## Security notes (2026-07-14 audit)

- Browser exposes only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional `VITE_AUTH_EMAIL_ALLOWLIST`
- Server secrets (OpenRouter, Firecrawl, Stripe, Google, ClickUp, Slack, service role) stay in Supabase secrets / Trigger.dev env
- No committed `.env` files found; `.env.example` files use placeholders only
