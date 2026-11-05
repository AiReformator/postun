# Postun Beta — security policy

Postun is an experimental project. No independent security audit, production SLA or zero-knowledge guarantee is claimed.

## Reporting a vulnerability

Do not publish exploit details, Telegram sessions, account identifiers, private conversations, OTPs, tokens or screenshots containing credentials in a public issue.

Use GitHub Private Vulnerability Reporting when it is enabled for this repository. The maintainer must enable and verify a private reporting channel before real beta onboarding. If the private report button is unavailable and no verified private contact is published, open only a minimal issue asking the maintainer to provide a private channel; do not include sensitive details.

The existence or availability of private reporting is not confirmed by this documentation package. Never invent a security email address.

## Supported versions

Only the latest explicitly published beta release is intended to receive fixes. Before relying on a release, inspect its actual security advisories, dependency lockfile and known limitations. This package itself is documentation, not an application release.

## Deployment responsibilities

Review source and dependencies. Use your own secrets. Do not reuse Postun SaaS credentials. Separate preview and production resources, restrict deploy privileges, rotate exposed credentials and confirm revocation. Keep message content and secrets out of diagnostics.

For the implementation contract and negative tests, read docs/03_SECURITY_PRIVACY.md and docs/05_ACCEPTANCE.md.
