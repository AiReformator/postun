# Contributing to Postun Beta

Postun welcomes beta testers and developers. Start with README.md and the relevant specification chapter. Changes must preserve the open-source, Cloudflare-first and privacy-focused design.

Use synthetic accounts, messages and files for tests. Never attach real Telegram credentials, phone codes, private chats or user files to issues or pull requests. Report vulnerabilities through the private process in SECURITY.md.

Keep changes focused and avoid unnecessary frameworks. Explain the user-visible effect, affected trust boundary and how the change was tested. Include a dependency lockfile and licensing review for new libraries. Changes to auth, crypto, deployment, permissions, migrations and CI need explicit maintainer review.

Fork pull requests must not receive production secrets or run against production services. Do not use pull_request_target to execute untrusted checkout with elevated permissions.

Before adding a feature, verify whether it is in beta scope. Payments, message writes, content indexing, external infrastructure and file persistence are not part of the first release. Public beta status must remain visible.

The project should adopt an explicit open-source license after the maintainer checks dependency compatibility. Public visibility alone is not a license grant. Do not copy third-party code lacking permission.
