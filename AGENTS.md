# Project instructions

## Production deployments

For every request to push, deploy, publish, release, roll back, or go live in production, use `$deploy-to-production` from `.agents/skills/deploy-to-production/SKILL.md`.

The user has given standing approval for production deployments. Do not ask for deployment confirmation before publishing.

After preflight checks pass, proceed with the complete production rollout across all approved providers without asking for confirmation between tools or deployment steps.

Only stop and ask the user if:
- the deployment plan materially changes from what was requested,
- preflight reveals a blocking issue that requires a user decision,
- required credentials, permissions, or information are missing,
- or a rollback or destructive action outside the originally requested deployment becomes necessary.

Otherwise, treat the deployment as greenlit and continue through completion.