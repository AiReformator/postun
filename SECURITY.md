# Postun Beta — security policy

Postun is an experimental project. No independent security audit, production SLA or zero-knowledge guarantee is claimed.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub Private Vulnerability Reporting:

https://github.com/AiReformator/postun/security/advisories/new

Please do not open a public issue or pull request for a suspected vulnerability. Do not publish exploit details, Telegram sessions, account identifiers, private conversations, OTPs, tokens or screenshots containing credentials anywhere public. A good report contains the affected component (auth, mcp, admin, web), the version or commit, reproduction steps on synthetic data, and the impact you expect.

What to expect: the maintainer aims to acknowledge a report within 7 days and to coordinate a fix and disclosure timing with you. This is a best-effort commitment for an experimental project, not an SLA. Fixes are published together with an advisory once users have had a reasonable chance to update.

If you accidentally exposed a real credential while testing, revoke or rotate it first, then report.

## Scope

In scope: this repository's code, configuration templates and documented deployment steps, including the OAuth/OIDC flows, session encryption, per-account access checks, the admin application and its isolation from message data, and CI/supply-chain configuration.

Out of scope: vulnerabilities in Cloudflare, Telegram or third-party services themselves (report these to the vendor), social engineering, denial of service by volume, and findings that require an already compromised operator account or Cloudflare account (the operator is part of the documented trust model).

## Supported versions

Only the latest published beta release (and the default branch) is intended to receive fixes. Before relying on a release, inspect its security advisories, dependency lockfile and known limitations.

## Deployment responsibilities

If you self-host: review source and dependencies, use your own secrets, never reuse another deployment's credentials, separate preview and production resources, restrict deploy privileges, rotate exposed credentials and confirm revocation, and keep message content and secrets out of diagnostics.

For the implementation contract and negative tests, read [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md) and [docs/05_ACCEPTANCE.md](docs/05_ACCEPTANCE.md).
