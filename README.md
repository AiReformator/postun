# Postun — open-source Telegram MCP server: connect your own Telegram to ChatGPT, Claude and Claude Code, read-only

**English** · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md) · [Deutsch](README.de.md)

*The English README is canonical; translations follow it and may lag behind.*

**Postun Beta** is an open-source, read-only [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server for Telegram. It links your own Telegram account to ChatGPT, Claude, Claude Code and other MCP clients, so an AI assistant can read your chats, search messages and look at public channels. You decide which accounts and which read scopes each AI client gets, and you can revoke access at any time. Message search, public channels and files are implemented but not yet verified on production (see [Beta status](#beta-status)).

- Site: https://postun.org (English, Русский, Español, Português, Deutsch)
- Cabinet: https://app.postun.org
- MCP endpoint: `https://mcp.postun.org/mcp`
- Repository: https://github.com/AiReformator/postun
- Status: **free beta**, experimental. No independent security audit has been done.

## What it is / Who it's for

Postun is a connector between a Telegram **user account** (not a bot) and an AI client that speaks MCP. After you link your account, the AI client can call a small set of read-only tools: list your dialogs, read message history, search messages, look at public channels and fetch file metadata or files.

It is for people who want an AI to help with their own Telegram data:

- summarize a group chat or a long conversation you missed;
- find something in your chat history by meaning, not only by keyword;
- review and analyze public channels you follow;
- pull context from Telegram into a ChatGPT, Claude or Claude Code session.

What it is **not**:

- Not a Telegram bot and not an "AI bot inside Telegram". Nothing is added to your chats and nothing talks in your name.
- Not a way to send messages, delete anything or change anything in Telegram. No write scope exists.
- Not zero-knowledge. See [Security and privacy model](#security-and-privacy-model).

## How it works

```text
Telegram login ──> QR link ──> OAuth grant ──> MCP tools
(OIDC, cabinet)   (MTProto,    (you pick the    (read-only calls from
                   optional     accounts and     ChatGPT / Claude /
                   2FA password) read scopes)    Claude Code)
```

1. **Sign in** to the cabinet at https://app.postun.org with Telegram.
2. **Link your account** by scanning a QR code in the Telegram app (MTProto login). If you use a cloud password (2FA), you enter it in the cabinet during linking.
3. **Connect an AI client.** The client opens an OAuth flow (with PKCE) on Postun's authorization server. On the consent screen you choose which linked accounts and which scopes (accounts, dialogs, history and search, public channels, files) this client may use.
4. **The AI client calls MCP tools** at `https://mcp.postun.org/mcp` with its access token. Each call is checked against the grant, then Telegram is read and the result is returned to the client.

You can revoke a client's grant or unlink an account in the cabinet at any time.

## Quick start (for users)

1. Open https://postun.org and go to the cabinet https://app.postun.org. Sign in with Telegram.
2. Link your Telegram account with the QR code.
3. Connect your AI client using the MCP URL:

```text
https://mcp.postun.org/mcp
```

**ChatGPT** (custom connector, developer mode): in ChatGPT settings enable developer mode, add a custom MCP connector, paste the MCP URL above, and complete the OAuth consent screen. Menu names depend on your plan and ChatGPT version.

**Claude Code:**

```bash
claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp
```

Then run `/mcp` inside Claude Code and authenticate `postun`. Note: the Claude Code flow has **not yet been verified** on production (see the [status table](#beta-status)).

**Other MCP clients** that support remote HTTP MCP servers with OAuth can use the same URL.

Tip for the beta: try it first with a test account or non-sensitive chats.

## MCP tools

All tools are **read-only**. There is no tool that sends, edits or deletes anything, and no write scope. The server enforces the scope of every tool regardless of client hints.

| Tool | What it does | Scope |
|---|---|---|
| `list_accounts` | Lists the Telegram accounts this client is allowed to use | `accounts:read` |
| `list_dialogs` | Lists chats, groups and channels (dialogs) | `dialogs:read` |
| `get_history` | Reads message history of a dialog | `messages:read` |
| `search_messages` | Searches messages | `messages:read` |
| `search_channels` | Searches public channels | `channels:read` |
| `get_channel_posts` | Reads posts of a public channel | `channels:read` |
| `get_media_info` | Returns metadata of a file or media item | `media:read` |
| `get_media` | Delivers a file or media item to the AI client | `media:read` |

## Security and privacy model

- **Encryption at rest.** Telegram sessions are encrypted with AES-256-GCM. Each account has its own key, wrapped by a key-encryption key (KEK) that is stored as a Cloudflare secret.
- **No logs of your conversations or requests.** Cloudflare logs are disabled, and the code may log only constant strings. This is enforced in CI (`npm run check:logging` and checks on Cloudflare logging configuration).
- **No archive.** Message and file content exists only in memory while it is being delivered to your AI client. Postun stores encrypted Telegram sessions, grants (permissions), daily counters and limited service metadata.
- **Read-only by construction.** Only read scopes exist: `accounts:read`, `dialogs:read`, `messages:read`, `channels:read`, `media:read`.
- **Revocable.** Revoke a client or unlink an account in the cabinet whenever you want.
- **Open source.** The code that handles encryption, access checks and logging is public (see the next section).

**What this is not.** Postun is **not zero-knowledge**. The operator and the infrastructure (Cloudflare Workers and Durable Objects) are part of the trust model: while a request is served, the service has to decrypt your session to talk to Telegram, and a malicious or compromised operator who controls the deployment and its secrets could technically read your data. The AI provider you connect (OpenAI, Anthropic, etc.) receives what the tools return and keeps it according to its own rules. Please use a test account first and decide what you are comfortable sharing.

Details: [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md).

## Philosophy: open by design (Kerckhoffs's principle)

The code is fully open so that anyone can check how encryption, access checks and the no-logs rule actually work. Following [Kerckhoffs's principle](https://en.wikipedia.org/wiki/Kerckhoffs%27s_principle), security must rely only on the secrecy of keys, not on hiding the system's design. Real keys live in Cloudflare secrets and never in this repository; what stays closed is only keys, tokens, user data, access configuration of our deployment and material of closed security incidents. If you do not want to trust our deployment, read the code and run your own (see Self-hosting).

## Beta status

Status comes from [apps/web/status.json](apps/web/status.json) (updated 2026-11-05). Only features with a recorded acceptance run on production are marked verified. Detailed results: [docs/RELEASE_STATUS.md](docs/RELEASE_STATUS.md).

| Feature | Status |
|---|---|
| Public site | Verified |
| Sign in with Telegram (OIDC) | Verified |
| Linking an account by QR | Verified |
| Linking an account with a cloud password (2FA) | Verified |
| ChatGPT: MCP connection (OAuth) | Verified |
| Reading dialogs and message history (via ChatGPT) | Verified |
| Claude Code: remote HTTP MCP | Not verified yet |
| Message search | Not verified yet |
| Public channels | Not verified yet |
| File download | Not verified yet |
| File as an attachment for the AI | Not verified yet |

"Not verified yet" means the code exists but has not passed an acceptance run on production. Do not rely on those features yet.

**Free beta limit:** 10,000 successful operations per UTC day per owner.

## Self-hosting

Running Postun in your own Cloudflare account, with your own keys, is **planned** and described in [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) and [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md). It is not yet a polished, supported install path. The goal is that the service does not depend on postun.org being up.

## Development

Postun runs on Cloudflare Workers, Durable Objects (SQLite-backed), D1 and Workers KV, written in TypeScript. Node.js 26 (`.nvmrc`), npm workspaces, one lockfile.

```bash
source ~/.nvm/nvm.sh && nvm use   # Node 26
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:secrets
npm run check:logging
```

`npm run ci` runs the whole chain. Tests use synthetic data and a local Workers runtime (Miniflare/workerd); real Telegram, IDP and Cloudflare resources are not used in CI. Real secrets are set only with `wrangler secret put` in your own Cloudflare account; variable examples are in `apps/*/.dev.vars.example` and `templates/.env.example`.

Repository layout:

```text
apps/web/            Cloudflare Workers static assets: beta landing, docs, cabinet (static)
apps/auth/           postun-auth: Telegram OIDC, web session, MCP OAuth (authorization server), cabinet API
apps/mcp/            postun-mcp: MCP resource server, SessionAndQuotaDO, Telegram (mtcute) adapter
apps/admin/          postun-admin: IDP OIDC BFF, aggregates, suspend/resume
packages/contracts/  shared schemas, scopes, envelope encryption, cursors, RPC contracts
migrations/control/  D1 postun-control (auth only)
migrations/admin/    D1 postun-admin-meta (admin only)
```

Guidelines for contributors: [CONTRIBUTING.md](CONTRIBUTING.md). Use synthetic data in tests and issues; never attach real credentials, login codes, private chats or files.

## Documentation

| Document | Purpose |
|---|---|
| [docs/01_PRODUCT_SPEC.md](docs/01_PRODUCT_SPEC.md) | Features, beta scenarios, limits and quotas |
| [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md) | Components, data and separation of duties |
| [docs/03_SECURITY_PRIVACY.md](docs/03_SECURITY_PRIVACY.md) | Encryption, what is open and what is closed |
| [docs/04_DEPLOYMENT.md](docs/04_DEPLOYMENT.md) | GitHub, Cloudflare, secrets and updates |
| [docs/05_ACCEPTANCE.md](docs/05_ACCEPTANCE.md) | Verifiable launch criteria |
| [docs/06_IDP_ADMIN.md](docs/06_IDP_ADMIN.md) | Administrator sign-in and role matrix |
| [docs/07_SOURCES.md](docs/07_SOURCES.md) | Official sources checked |
| [docs/08_AUDIT.md](docs/08_AUDIT.md) | Documentation changes and remaining checks |
| [docs/RELEASE_STATUS.md](docs/RELEASE_STATUS.md) | Acceptance results (PASS / FAIL / NOT_RUN / BLOCKED) |
| [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md) | Deployment runbook |
| [docs/PUBLICATION_POLICY.md](docs/PUBLICATION_POLICY.md) | What is published where: code on GitHub, legal documents on the site, marketing never |

The in-depth documentation is written mostly in Russian.

## Security reporting

Report vulnerabilities privately through GitHub private vulnerability reporting for this repository; see [SECURITY.md](SECURITY.md). Do not put exploit details, Telegram sessions, private conversations, login codes or tokens into public issues.

## License

[Apache-2.0](LICENSE).

## FAQ

**What is a Telegram MCP server?**
MCP (Model Context Protocol) is an open standard that lets AI clients such as ChatGPT, Claude and Claude Code call external tools. A Telegram MCP server exposes Telegram data as such tools. Postun is a hosted, read-only one that works with your own Telegram account.

**Is Postun a Telegram bot?**
No. A bot lives inside Telegram and you chat with it. Postun does not add anything to Telegram: it uses a login of your own user account and exposes read-only tools to your AI client. If you are looking for "ChatGPT bots in Telegram", this is a different thing.

**How do I connect Telegram to ChatGPT or Claude?**
Sign in at https://app.postun.org, link your account by QR code, then add `https://mcp.postun.org/mcp` as a custom MCP connector in ChatGPT (developer mode), or run `claude mcp add --scope user --transport http postun https://mcp.postun.org/mcp` for Claude Code. See [Quick start](#quick-start-for-users).

**Is it safe?**
It is designed to be careful: read-only scopes, encrypted sessions, no logs of conversations, revocable access, open code. But it is a beta without an independent audit, and it is not zero-knowledge: the operator and Cloudflare infrastructure are part of the trust model, and your AI provider keeps data under its own rules. Try it with non-sensitive data first.

**Is it free?**
Yes, the beta is free, with a limit of 10,000 successful operations per UTC day per owner. There are no payments in the beta, and the limit may change.

**Can the AI send messages or change my Telegram?**
No. Only read tools exist, and the server enforces read scopes.
