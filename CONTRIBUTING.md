# Contributing to Postun Beta

Postun welcomes beta testers and developers. Start with README.md and the relevant specification chapter. Changes must preserve the open-source, Cloudflare-first and privacy-focused design.

Use synthetic accounts, messages and files for tests. Never attach real Telegram credentials, phone codes, private chats or user files to issues or pull requests. Report vulnerabilities through the private process in SECURITY.md.

Keep changes focused and avoid unnecessary frameworks. Explain the user-visible effect, affected trust boundary and how the change was tested. Include a dependency lockfile and licensing review for new libraries. Changes to auth, crypto, deployment, permissions, migrations and CI need explicit maintainer review.

Fork pull requests must not receive production secrets or run against production services. Do not use pull_request_target to execute untrusted checkout with elevated permissions.

Before adding a feature, verify whether it is in beta scope. Payments, message writes, content indexing, external infrastructure and file persistence are not part of the first release. Public beta status must remain visible.

The project is licensed under Apache-2.0 (see LICENSE); contributions are accepted under the same license. Check dependency license compatibility for new libraries. Do not copy third-party code lacking permission.

## Engineering and security invariants

These rules are what reviewers check in every pull request.

- Fail closed. Missing or invalid authentication or authorization configuration must deny the request, never fall back to a weaker mode. There are no public debug, impersonation or arbitrary-SQL endpoints.
- Authorize every account, tool and file request on the server. Revoked access must stay revoked: the authoritative deny state wins over any cached or stale copy.
- Keep trust boundaries separate: Telegram user login, MTProto account authorization, MCP OAuth and administrator sign-in are different boundaries, and each component owns its own storage and secrets (see docs/03_SECURITY_PRIVACY.md).
- Use maintained protocol, crypto and OAuth libraries. Do not implement MTProto, SRP or cryptographic primitives from scratch.
- Never put secrets, sessions, tokens, message bodies or real documents into Git, logs, screenshots, issues, fixtures or prompts. Secrets are supplied only through the deployment platform (for example `npx wrangler secret put NAME`) or an untracked local file such as `.dev.vars`. Run `node scripts/check-no-secrets.mjs` before pushing.
- Do not log message or file content. Logs and metadata follow the documented retention policy; the service keeps no persistent archive of messages or files, and the project does not claim zero-knowledge.
- Tests use synthetic data only: fake accounts, fake messages, generated files.
- Untrusted pull requests run in secretless CI with synthetic data. Never run untrusted code with production bindings or credentials, and never use `pull_request_target` with a checkout of the pull request. A preview URL alone does not isolate data; check which bindings a preview actually uses.
- Migrations are additive and are rehearsed on non-empty synthetic data. A normal release never resets, reseeds or recreates production resources.
- Keep one lockfile, commit it with dependency changes, and prefer small typed modules over new frameworks or services.
- Keep entitlement and usage-limit logic separate from session identity. Billing is out of beta scope.
- Report real results: do not describe tests, builds or deployments as passed unless they were actually run.
