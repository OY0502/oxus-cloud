---
name: deploy-to-production
description: Safely validate and release OXUS Cloud across Supabase, Trigger.dev, Pinecone, and Vercel. Use for requests such as push to production, deploy, publish, release, go live, production rollout, or production rollback.
---

# Deploy OXUS Cloud to production

Use this only in `E:\Code Projects\oxus-cloud` or a checkout of the same repository. Read [references/production-runbook.md](references/production-runbook.md) completely before any real deployment or rollback.

## Mandatory safety gates

- Read-only inspection, local tests/builds, and provider dry runs may proceed without deployment authorization.
- Immediately before **each production-changing phase**, show the exact target, effect, and commands, then ask the user for explicit confirmation. A general request such as “deploy” does not satisfy this immediate confirmation gate. Do not combine a confirmation request with executing the mutation.
- Production-changing phases are: Supabase secret/config changes, database migration push, Edge Function deployment, Trigger.dev deployment, Vercel production deployment/promotion, Pinecone backfill or mode switch, and rollback.
- Never print, persist, paste into source, or return secret values. Refer only to secret names. If a command must use a credential, obtain it from an authenticated CLI or environment in memory and ensure output cannot reveal it.
- Stop after any failed mutation. Diagnose with read-only checks, show the revised command and impact, and obtain fresh confirmation before retrying.
- Release only from a clean, pushed `main` at a named commit. A dirty tree, another branch, a missing `origin/main`, or a local/remote commit mismatch blocks deployment. Never reset, clean, commit, or push merely to pass this gate; report the blocker and let the user authorize or perform the Git operation separately.

## Workflow

1. Fetch `origin/main`, then confirm the repository root, clean `main`, the exact release commit, and fixed production targets from the runbook.
2. Run `scripts/preflight.ps1`. Also run the provider identity checks and Supabase migration dry run in the runbook.
3. Report failures, warnings, the named release commit, pending migrations, and affected functions. Do not mutate production yet.
4. Execute the runbook phases in order, honoring the confirmation gate before every phase.
5. Keep Pinecone in `shadow` until the v2 index is ready, the outbox is drained, namespace counts are nonzero, and shadow retrieval has no error. Obtain a separate confirmation before switching `PINECONE_RETRIEVAL_MODE=primary`.
6. Run `scripts/public-smoke.ps1` and the authenticated post-deploy checks in the runbook. Report deployment URLs/versions and observed counts without exposing credentials.
7. If acceptance checks fail, stop and use the relevant rollback guidance. Rollback is itself production-changing and requires immediate explicit confirmation.
