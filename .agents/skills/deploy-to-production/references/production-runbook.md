# OXUS Cloud production runbook

This runbook records the production procedure verified on 2026-08-24. Commands are PowerShell unless stated otherwise. Never include credential values in logs, chat, files, or command text.

## Fixed targets and paths

- Repository: `E:\Code Projects\oxus-cloud`
- Application/Supabase root: `E:\Code Projects\oxus-cloud\artifacts\oxus-cloud`
- Git remote: `https://github.com/OY0502/oxus-cloud.git`
- Required deployment branch: `main`
- Supabase project ref: `xyphlqyujifneqqtzmto`
- Vercel org/project: `oxus/oxus-cloud`
- Vercel IDs: org `team_WCQTCMadHEiNgE8IaIyzu8tr`, project `prj_qbYPLFS9Ct96amuyIK7hpNAnfBDz`
- Production domain: `https://oxus.cloud`
- Trigger.dev project: `proj_obirqjqllcyukpslcckr` (`OXUS Cloud`)
- Pinecone index: `oxus-project-knowledge-v2`
- Pinecone serverless location: AWS `us-east-1`
- Pinecone metric/dimension: `dotproduct`, `1536`
- Pinecone namespace: `project-{lowercase-project-uuid}`

### Git release policy

Future production releases require a clean, pushed `main` at a named commit. Before preflight, run `git fetch origin main`, then require all of the following: current branch is `main`, `git status --porcelain` is empty, upstream is `origin/main`, and local `HEAD` exactly equals `origin/main`. Record the full commit SHA in the release report and confirmations.

The previously verified release came from a dirty, uncommitted `main`; do not repeat that weakly auditable approach. If the gate fails, stop. Never reset, clean, commit, or push just to make the deployment pass unless the user separately authorizes that Git action.

## Secret and environment names

These names may be checked for presence. Never print or persist their values.

- Supabase/runtime: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Embeddings: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `OPENROUTER_API_KEY`, optionally `OPENAI_API_KEY`
- Pinecone: `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `PINECONE_INDEX_HOST`, `PINECONE_API_VERSION`, `PINECONE_CLOUD`, `PINECONE_REGION`, `PINECONE_RETRIEVAL_MODE`, `PINECONE_HYBRID_ENABLED`, `PINECONE_HYBRID_ALPHA`, `PINECONE_SPARSE_MODEL`, `PINECONE_RERANK_ENABLED`, `PINECONE_RERANK_MODEL`
- Trigger.dev: `TRIGGER_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optionally `GOOGLE_SYNC_WORKER_SECRET`

`PINECONE_API_KEY`, `OPENROUTER_API_KEY`, `EMBEDDING_PROVIDER`, and the standard Supabase runtime secrets existed in production during the verified release. Presence is not proof that their values are correct.

## 1. Local preflight — no production mutation

From the repository root:

```powershell
git fetch origin main
& '.\.agents\skills\deploy-to-production\scripts\preflight.ps1'
```

Fetching updates the local remote-tracking ref but does not change production. The script blocks unless `main` is clean and exactly matches `origin/main`, prints the named commit, verifies fixed provider IDs, and uses the app-local Vitest, TypeScript, and Vite binaries. This avoids the package-runner failures in the error ledger.

Expected verified baseline:

- 18 test files and 158 tests passed.
- App typecheck passed.
- Edge core typecheck and touched-file syntax checks passed when relevant Edge files changed.
- Vite production build succeeded.
- Node 20.19+ is preferred locally. Node 20.17 built successfully but emitted a Vite version warning.

When Edge files changed, also transpile/typecheck the touched Edge entrypoints and shared modules before deployment. Do not fabricate a temporary declaration file outside the workspace; if an ambient declaration is needed, create it under `artifacts/oxus-cloud/scripts`, run the check, then remove it.

Run scoped whitespace validation against the files in the release. Do not “fix” unrelated dirty paths merely to make a global check green.

## 2. Read-only provider and migration checks

Run from `artifacts/oxus-cloud`. These need authenticated CLIs and network access but do not change production:

```powershell
npx --yes supabase@2.109.1 secrets list --project-ref xyphlqyujifneqqtzmto
npx --yes supabase@2.109.1 migration list --linked
npx --yes supabase@2.109.1 db push --linked --dry-run
npx --yes trigger.dev@4.5.0 whoami
& '..\..\.agents\skills\deploy-to-production\scripts\verify-trigger-production-env.ps1'
npx --yes vercel@latest whoami
```

Validate all of the following before requesting deployment confirmation:

- Supabase is linked to `xyphlqyujifneqqtzmto`.
- The dry run lists only intended migrations.
- Trigger.dev resolves to `proj_obirqjqllcyukpslcckr` in org `OXUS`.
- Trigger.dev Production lists both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with hidden values. Never add `--show-values`.
- Vercel resolves to the `oxus` account/project.
- Required secret **names** exist. Do not echo the returned key material or hashes.
- `.vercel/project.json`, `supabase/.temp/project-ref`, and `trigger.config.ts` match the fixed targets above.

If `npx` hangs with no output in the sandbox, stop it and rerun the same read-only command with approved external network access. Do not interpret the hang as a provider failure.

## 3. Production-changing phases

After all read-only checks pass, show one consolidated plan with the named commit and every target/effect/command in Phases A–F. Immediately before Phase A, obtain one explicit confirmation for the complete rollout. Then execute all approved phases across Supabase, Trigger.dev, Vercel, and Pinecone without asking between tools. The helper confirmation phrases are deterministic execution guards and may be supplied by the agent after this consolidated approval; they do not require additional chat prompts.

If a command fails, stop further mutations and diagnose read-only. Retry without another prompt only when the command is unchanged and evidence proves it did not apply. Obtain a new consolidated confirmation if the command/impact changes, the outcome is ambiguous, the work becomes a new release attempt, or rollback/destructive recovery is proposed.

### Phase A — Pinecone configuration in shadow mode

Target: Supabase Edge Function secrets for `xyphlqyujifneqqtzmto`.

```powershell
npx --yes supabase@2.109.1 secrets set PINECONE_INDEX_NAME=oxus-project-knowledge-v2 PINECONE_API_VERSION=2026-04 PINECONE_CLOUD=aws PINECONE_REGION=us-east-1 PINECONE_RETRIEVAL_MODE=shadow PINECONE_HYBRID_ENABLED=true PINECONE_HYBRID_ALPHA=0.65 PINECONE_SPARSE_MODEL=pinecone-sparse-english-v0 PINECONE_RERANK_ENABLED=true PINECONE_RERANK_MODEL=bge-reranker-v2-m3 EMBEDDING_DIMENSIONS=1536 --project-ref xyphlqyujifneqqtzmto
```

Do not put `PINECONE_API_KEY`, embedding API keys, or Supabase keys on this command line. They must already exist in the provider secret store or be set through a separately approved secure mechanism.

### Phase B — database migrations

Target: linked production Postgres database.

```powershell
npx --yes supabase@2.109.1 db push --linked --yes
```

The verified release applied:

- `20260824230000_pinecone_primary_knowledge.sql`
- `20260824233000_project_chat_sessions.sql`

The migration is transactional. Expected `NOTICE ... does not exist, skipping` messages from defensive `drop ... if exists` statements are not errors. After the push, rerun `migration list --linked` read-only and require matching local/remote versions.

### Phase C — affected Supabase Edge Functions

Run from `artifacts/oxus-cloud`. Deploy only affected entrypoints; shared modules are bundled automatically.

```powershell
npx --yes supabase@2.109.1 functions deploy pinecone-chat-memory --project-ref xyphlqyujifneqqtzmto --no-verify-jwt --use-api
npx --yes supabase@2.109.1 functions deploy project-agent-run --project-ref xyphlqyujifneqqtzmto --use-api
npx --yes supabase@2.109.1 functions deploy project-agent-run-worker --project-ref xyphlqyujifneqqtzmto --no-verify-jwt --use-api
npx --yes supabase@2.109.1 functions deploy embed-project-knowledge --project-ref xyphlqyujifneqqtzmto --no-verify-jwt --use-api
npx --yes supabase@2.109.1 functions deploy generate-project-brief --project-ref xyphlqyujifneqqtzmto --use-api
npx --yes supabase@2.109.1 functions deploy import-figma-context --project-ref xyphlqyujifneqqtzmto --use-api
npx --yes supabase@2.109.1 functions deploy enrich-project-from-website --project-ref xyphlqyujifneqqtzmto --no-verify-jwt --use-api
npx --yes supabase@2.109.1 functions deploy clickup-sync-project-docs --project-ref xyphlqyujifneqqtzmto --no-verify-jwt --use-api
```

Preserve the JWT flags exactly. `--use-api` avoids a local Docker dependency.

### Phase D — Trigger.dev tasks

Target: production project `proj_obirqjqllcyukpslcckr`.

Use the existing Trigger.dev **Production Environment Variables** as the authoritative secure source for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not copy the service-role key into the repository, command line, chat, or local `.env`, and do not require either value in the local process. Immediately before requesting confirmation, deterministically verify the two names remotely while values remain hidden:

```powershell
& '..\..\.agents\skills\deploy-to-production\scripts\verify-trigger-production-env.ps1'
```

The helper runs the exact read-only provider command `npx --yes trigger.dev@4.5.0 env list --project-ref proj_obirqjqllcyukpslcckr --env prod --skip-telemetry`, requires both names, suppresses the provider listing, and never uses `--show-values`. After the immediate production confirmation, deploy from `artifacts/oxus-cloud`:

```powershell
npx --yes trigger.dev@4.5.0 deploy
```

A local `syncEnvVars` warning about those variables being unavailable is non-blocking because the existing remote Production values are intentionally retained. Stop only if either remote name is missing or the deploy itself fails. The verified deployment produced version `20260824.2` with 43 tasks. Version numbers will change.

### Phase E — Vercel production application

Run from the **repository root**, not `artifacts/oxus-cloud`:

```powershell
npx --yes vercel@latest deploy . --prod --yes --project oxus-cloud --scope oxus
```

Require `readyState: READY` and an alias to `https://oxus.cloud`. The verified successful deployment was `dpl_3zWYsMXa8oPYFuTM7XakzQsK2rte`; future IDs will differ.

### Phase F — Pinecone setup, backfill, and primary switch

The helper retrieves the service-role key through the authenticated Supabase CLI, keeps it in memory, and never prints it. Its confirmation phrase is an internal execution guard. Once the consolidated rollout is approved, supply the phrase for each listed action without asking the user again.

Create/verify the v2 index for one active project:

```powershell
& '.\.agents\skills\deploy-to-production\scripts\invoke-pinecone-admin.ps1' -Action setup -ProjectId '<PROJECT_UUID>' -ConfirmationPhrase 'CONFIRM setup production'
```

Drain the durable outbox until a subsequent call reports `processed: 0`, then inspect job rows and namespace counts rather than treating zero as failure:

```powershell
& '.\.agents\skills\deploy-to-production\scripts\invoke-pinecone-admin.ps1' -Action process_outbox -ConfirmationPhrase 'CONFIRM process_outbox production'
```

Status is read-only and needs no confirmation phrase:

```powershell
& '.\.agents\skills\deploy-to-production\scripts\invoke-pinecone-admin.ps1' -Action status -ProjectId '<PROJECT_UUID>'
```

Keep shadow mode until all active project namespaces are ready, vector counts are nonzero, outbox jobs are completed, sync errors are null, and a shadow retrieval probe returns candidates/reranks. In shadow mode, `mode: vector` and `pinecone_used: false` are expected because Supabase still supplies the answer. Inspect `project_chat_vector_sync.metadata` for `retrieval_mode`, `candidates`, `reranked`, `result_overlap`, and errors.

When all shadow acceptance gates pass, switch primary under the existing consolidated rollout authorization:

```powershell
npx --yes supabase@2.109.1 secrets set PINECONE_RETRIEVAL_MODE=primary --project-ref xyphlqyujifneqqtzmto
```

Then run a confirmed retrieval probe; it updates sync diagnostics:

```powershell
& '.\.agents\skills\deploy-to-production\scripts\invoke-pinecone-admin.ps1' -Action test_query -ProjectId '<PROJECT_UUID>' -Query 'Summarize the current project status and latest blockers' -ConfirmationPhrase 'CONFIRM test_query production'
```

Require `mode: pinecone_hybrid`, `pinecone_used: true`, positive matches, and no `pinecone_error`.

## 4. Post-deployment checks

### Public application — read-only

From the repository root:

```powershell
& '.\.agents\skills\deploy-to-production\scripts\public-smoke.ps1'
```

Require HTTP 200 and all three bundle markers: new-chat UI, delete-chat UI, and Pinecone retrieval UI.

### Production data and retrieval

- `project_chat_messages.chat_session_id` has no null values.
- Existing chat messages were assigned to sessions.
- Creating a new chat changes only transcript state; retrieval still uses the project namespace.
- Deleting a non-running chat cascades its messages but does not alter project knowledge or Pinecone vector counts.
- A running chat cannot be deleted.
- `project_knowledge_index_jobs` has no pending/running/failed jobs after drain.
- Every active project has `project_chat_vector_sync.status = ready`, nonzero namespace vectors, and `last_error is null`.
- Primary retrieval returns `pinecone_hybrid`; Supabase fallback remains available on Pinecone error.

Verified 2026-08-24 observations:

- Existing transcript backfill: 1 session, 16 messages, 0 messages without a session.
- Active knowledge projects: 2.
- Pinecone namespace counts: 134 and 1.
- Outbox: 2 completed, 0 failed.
- Primary retrieval: 5/5 matches for the main project and 1/1 for the smaller project, with no Pinecone errors.
- Disposable chat deletion removed the session and its message while the main namespace stayed at 134 vectors.

Project IDs observed in that verification were `adaedb34-2f40-4077-bf68-cb120bbfa945` and `fe095d7f-bbf1-4f1b-9e51-97c55787d5dd`. Enumerate current active projects instead of assuming this list remains complete.

## 5. Rollback guidance

Rollback was not exercised during the verified release. Rollback is outside the consolidated release authorization: show the rollback target/effect/commands and obtain one explicit confirmation for the complete rollback plan before changing production.

### Pinecone/retrieval

Fastest safe mitigation:

```powershell
npx --yes supabase@2.109.1 secrets set PINECONE_RETRIEVAL_MODE=shadow --project-ref xyphlqyujifneqqtzmto
```

Use `off` only if both Pinecone querying and shadow diagnostics must stop. Do not delete the v2 index; deletion protection is enabled, and Supabase remains the source registry/fallback.

### Vercel

Promote the last known-good deployment from Vercel deployment history. No rollback command was exercised in this conversation, so inspect `vercel rollback --help` or use the dashboard rather than inventing syntax. Verify `https://oxus.cloud` after promotion.

### Supabase Edge Functions and Trigger.dev

Checkout or otherwise materialize a known-good source revision, rerun local verification, and redeploy only the affected functions/task bundle. This is why a commit-based release policy is preferable. Do not overwrite the working tree to obtain the revision without separate user authorization.

### Database

There is no verified automatic down migration. Prefer a reviewed forward-fix migration. Do not manually drop chat-session, lifecycle, or outbox schema in production. Preserve transcript and knowledge data; take/verify a backup before any destructive repair.

## 6. Error ledger and prevention rules

These are the deployment-related errors and warnings encountered while establishing the runbook.

1. **`pnpm run typecheck` failed before compilation because the package runner's global-store SQLite state was unavailable.** Use app-local binaries through `scripts/preflight.ps1`. Treat package-runner infrastructure failure separately from code failure.
2. **Relative `.node_modules\.bin` commands were reported as not recognized.** Resolve and invoke absolute local binary paths with PowerShell's call operator; the preflight script does this and accepts `.CMD` or extensionless binaries.
3. **`npx` provider commands hung silently in the restricted sandbox.** Stop stalled sessions; rerun the same command with explicitly approved external network access. Do not retry indefinitely or diagnose this as provider downtime.
4. **The first Vercel production deploy failed because it ran from `artifacts/oxus-cloud`; Vercel then could not find configured Root Directory `artifacts/oxus-cloud`.** Always run the exact Vercel command from repository root with `--project oxus-cloud --scope oxus`. Verify `READY` and the production alias; the failed deployment never changed the alias.
5. **Trigger.dev deploy warned that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` were unavailable to local `syncEnvVars`.** This is intentionally non-blocking: the verified deployment inherited the existing remote Production values. Before every Trigger deploy, run `env list` for `proj_obirqjqllcyukpslcckr`/`prod`, require both names with hidden values, never use `--show-values`, and never copy the service-role key into the repo or local `.env`.
6. **A global `git diff --check` reported unrelated, pre-existing blank lines at EOF.** Scope whitespace checks to release files and preserve unrelated dirty work. Do not edit unrelated files just to make global output clean.
7. **`psql` was not installed locally.** Use the linked Supabase migration dry run and transactional push; if deeper SQL parsing is required, use an approved local Supabase/Postgres environment instead of skipping validation.
8. **Windows `rg` rejected a shell-style path glob such as `supabase/functions/*/index.ts`.** Search the directory and pass `-g 'index.ts'` rather than putting `*` in the Windows path.
9. **A PowerShell ad-hoc coverage audit assumed every REST result exposed `project_id` and failed on an unexpected result shape.** Use deterministic scripts, validate response properties before aggregation, and rely on authoritative outbox/sync/namespace status checks. Do not copy that abandoned one-liner.
10. **`process_outbox` returned `processed: 0` after jobs had already been completed by Trigger.dev.** Inspect job status and namespace counts before declaring failure; zero means the queue may already be drained.
11. **Shadow probes returned `mode: vector` and `pinecone_used: false`.** This is expected in shadow mode. Use sync metadata for Pinecone candidate/rerank diagnostics; only primary mode should report `pinecone_hybrid` and `pinecone_used: true`.
12. **Vite emitted Node-version, source-map, dynamic/static import, and large-bundle warnings.** Node 20.19+ prevents the version warning. The remaining warnings were non-fatal in the verified build, but record and reassess new or changed warnings rather than suppressing them.
13. **Supabase and Trigger CLIs reported newer versions available.** Pin the verified command versions for reproducibility (`supabase@2.109.1`, `trigger.dev@4.5.0`) until an intentional CLI upgrade is separately tested.
14. **The verified release was made from a dirty, uncommitted `main`, so its exact source could not be reproduced from Git alone.** Future releases must pass the clean, pushed `main` gate and record the exact `HEAD` SHA before any production mutation.
