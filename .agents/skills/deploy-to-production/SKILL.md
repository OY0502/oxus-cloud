---
name: deploy-to-production
description: Safely validate and release OXUS Cloud across Supabase, Trigger.dev, Pinecone, and Vercel with one consolidated production authorization. Use for requests such as push to production, deploy, publish, release, go live, production rollout, or production rollback.
---

# Deploy OXUS Cloud to production

Use this only in `E:\Code Projects\oxus-cloud` or a checkout of the same repository. Read [references/production-runbook.md](references/production-runbook.md) completely before any real deployment or rollback.

## Mandatory safety gates

- Read-only inspection, local tests/builds, and provider dry runs may proceed without deployment authorization.
- After preflight and immediately before the first production-changing command, present one consolidated release plan containing the named commit, targets, effects, and commands for Supabase configuration/migrations/functions, Trigger.dev, Vercel, and Pinecone. Ask once for explicit confirmation of the complete rollout. A general request such as “deploy” does not satisfy this final authorization gate.
- That single confirmation authorizes every listed phase in the current release attempt. Continue across providers without asking again between tools, including Pinecone setup, backfill, validation probes, and the primary-mode switch when its acceptance gates pass.
- Ask again only when the proposed mutation is outside or materially different from the approved plan, an outcome is ambiguous, the release is resumed as a new attempt, or rollback/destructive recovery is proposed. An unchanged retry is allowed without another prompt only when read-only evidence proves the failed command made no production change.
- Never print, persist, paste into source, or return secret values. Refer only to secret names. If a command must use a credential, obtain it from an authenticated CLI or environment in memory and ensure output cannot reveal it.
- Stop the mutation sequence after a failure and diagnose with read-only checks. Resume under the existing authorization only for an unchanged command proven not to have applied; otherwise present the revised plan and obtain a new consolidated confirmation.
- Release only from a clean, pushed `main` at a named commit. A dirty tree, another branch, a missing `origin/main`, or a local/remote commit mismatch blocks deployment. Never reset, clean, commit, or push merely to pass this gate; report the blocker and let the user authorize or perform the Git operation separately.

## Workflow

1. Fetch `origin/main`, then confirm the repository root, clean `main`, the exact release commit, and fixed production targets from the runbook.
2. Run `scripts/preflight.ps1`. Also run the provider identity checks and Supabase migration dry run in the runbook.
3. Report failures, warnings, the named release commit, pending migrations, and affected functions. Do not mutate production yet.
4. Present the complete rollout once and obtain one explicit confirmation immediately before Phase A. Then execute all approved phases in order without provider-by-provider prompts.
5. Keep Pinecone in `shadow` until the v2 index is ready, the outbox is drained, namespace counts are nonzero, and shadow retrieval has no error. If those gates pass, switch `PINECONE_RETRIEVAL_MODE=primary` under the same rollout authorization; otherwise stop and report the unmet gate.
6. Run `scripts/public-smoke.ps1` and the authenticated post-deploy checks in the runbook. Report deployment URLs/versions and observed counts without exposing credentials.
7. If acceptance checks fail, stop and propose the relevant rollback guidance. Rollback is outside the release authorization and requires its own explicit confirmation.
