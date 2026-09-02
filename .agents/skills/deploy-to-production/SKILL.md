Deploy OXUS Cloud to production

Use this only in E:\Code Projects\oxus-cloud or a checkout of the same repository. Read references/production-runbook.md completely before any real deployment or rollback.

Authorization and safety

Treat a direct user request to deploy, publish, release, push to production, or go live as authorization for the complete standard production rollout defined in the runbook. Do not ask for an additional confirmation after preflight or between providers.

The authorization covers the current release attempt at the verified origin/main commit, including Supabase configuration, migrations and functions, Trigger.dev, Vercel, Pinecone setup and backfill, validation probes, and the Pinecone primary-mode switch when its acceptance gates pass.

Before the first production-changing command, report the verified commit, targets, pending migrations, affected functions, warnings, and planned rollout. This is an informational checkpoint, not an approval gate; continue automatically when preflight passes.

Retry failed commands automatically when read-only evidence shows the command did not apply or when the retry is idempotent and does not broaden the rollout. If the production state is ambiguous, stop and report it instead of guessing.

Stop and ask for new authorization only when the required action materially expands the requested rollout, requires destructive recovery, or is a rollback that the user did not already request. A direct rollback request authorizes the standard rollback procedure in the runbook without a second confirmation.

Never print, persist, paste into source, or return secret values. Refer only to secret names. Use authenticated CLIs or environment credentials in memory, and prevent command output from revealing them.

Release only from a clean, pushed main at a named commit. A dirty tree, another branch, a missing origin/main, or a local/remote commit mismatch blocks deployment. Never reset, clean, commit, or push merely to pass this gate; report the blocker.

Workflow

Fetch origin/main, then confirm the repository root, clean main, the exact release commit, and fixed production targets from the runbook.

Run scripts/preflight.ps1, the provider identity checks, and the Supabase migration dry run from the runbook.

Report failures or warnings, the named release commit, pending migrations, affected functions, targets, effects, and commands. If a blocking check fails, stop. Otherwise continue automatically without asking for confirmation.

Execute every standard rollout phase in runbook order. Do not pause for provider-by-provider approval.

Keep Pinecone in shadow until the v2 index is ready, the outbox is drained, namespace counts are nonzero, and shadow retrieval has no error. If those gates pass, switch PINECONE_RETRIEVAL_MODE=primary automatically under the deployment authorization. Otherwise stop and report the unmet gate.

Run scripts/public-smoke.ps1 and the authenticated post-deploy checks in the runbook. Report deployment URLs, versions, and observed counts without exposing credentials.

If acceptance checks fail, stop and report the failure plus the relevant rollback guidance. Do not roll back unless the user explicitly requested rollback or subsequently authorizes it.

Permission prompts

Do not add conversational confirmation prompts that duplicate the user's deployment or rollback request.

Platform-, operating-system-, CLI-, or connector-enforced permission dialogs may still appear and cannot be bypassed by this skill. Group operations into the fewest tool calls practical so any unavoidable platform prompts are consolidated.          