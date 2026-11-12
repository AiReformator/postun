// Crawler files generated at build time: robots.txt, sitemap.xml (with hreflang) and llms.txt.
import { LOCALES, SITE } from '../i18n/index.mjs';
import { USE_CASE_COUNT } from './pages.mjs';

const REPO = 'https://github.com/AiReformator/postun';
/** Indexable pages (the cabinet /app/ is intentionally excluded). */
const PAGES = ['/', '/use-cases/', '/status/', '/privacy/', '/terms/'];

export const robotsTxt = () => `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;

export function sitemapXml(lastmod) {
  const urls = [];
  for (const page of PAGES) {
    const alts = LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.htmlLang}" href="${SITE}${l.prefix}${page}"/>`);
    alts.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${page}"/>`);
    for (const l of LOCALES) {
      urls.push(`  <url>\n    <loc>${SITE}${l.prefix}${page}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n${alts.join('\n')}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

export function llmsTxt(status) {
  const quota = Number(status.quota_daily_success ?? 10000).toLocaleString('en');
  const claude = status.features.find((f) => f.id === 'mcp_claude_code')?.status === 'PASS' ? 'verified' : 'in testing, not yet verified';
  const names = { en: 'English (default)', ru: 'Russian', es: 'Spanish', pt: 'Portuguese (Brazil)', de: 'German' };
  const st = Object.fromEntries(status.features.map((f) => [f.id, f.status]));
  const extra = [['search', 'search'], ['channels', 'public channels'], ['file_download', 'file downloads']];
  const pending = extra.filter(([id]) => st[id] !== 'PASS').map(([, name]) => name);
  const verifiedExtra = pending.length
    ? `${pending.join(', ').replace(/^./, (c) => c.toUpperCase())} ${pending.length > 1 ? 'are' : 'is'} not yet verified.`
    : 'Search, public channels and file downloads are verified too.';
  return `# Postun

> Postun Beta is an open-source MCP server (a Telegram MCP connector) that works in transit: it passes your messages to your AI on request and does not store, log or view them. It links your own Telegram account to ChatGPT, Claude / Claude Code and other MCP clients through OAuth. You choose which Telegram accounts and which read scopes (accounts, dialogs, history and search, public channels, files) each AI client gets, and you can revoke access at any time. It is not a Telegram bot and it cannot send, edit or delete messages.

## Key facts

- Status: free open beta, experimental, no SLA. Limit: ${quota} successful operations per UTC day per owner.
- Connection: QR login to Telegram over MTProto (a cloud password / two-step verification is supported); AI clients connect through OAuth.
- Verified on production: Telegram sign-in, QR linking, two-step verification, ChatGPT (OAuth, reading dialogs, history, groups). Claude Code: ${claude}. ${verifiedExtra} The live status table is on the home page.
- Security: runs on Cloudflare Workers and Durable Objects; Telegram sessions are encrypted with AES-256-GCM using a per-account key wrapped by a master key kept in Cloudflare secrets.
- Privacy: no logs of conversations or requests (Cloudflare logs disabled, enforced in CI; code may only log constant strings). Message content exists only in memory while it is delivered to your AI client. Not zero-knowledge: the operator and infrastructure are part of the trust model, and your AI provider keeps data under its own rules.
- Open by design: the code is fully open (Kerckhoffs's principle) so anyone can verify how encryption, access checks and the no-logs rule work; security relies only on secret keys, which are never in the repository.
- Self-hosting on your own Cloudflare account is planned.

## Connect

- MCP endpoint (streamable HTTP, OAuth): https://mcp.postun.org/mcp
- Dashboard (sign in, link Telegram, manage clients): https://app.postun.org
- Claude Code: \`claude mcp add --transport http postun https://mcp.postun.org/mcp\`

## Use cases

Ask your AI to summarize Telegram channels and long chats, build a digest of the channels you follow, review articles shared in groups, recap decisions and tasks from work chats, prepare for a client call, find a message, link or file, check where a fact first appeared, or let Claude Code sort bug reports from a support chat. Postun only reads: it does not post, schedule, watch channels or export files. ${USE_CASE_COUNT} use cases with prompts and limits: ${SITE}/use-cases/

## Site

${LOCALES.map((l) => `- [${names[l.code]}](${SITE}${l.prefix}/)`).join('\n')}
- [Use cases](${SITE}/use-cases/)
- [Service status](${SITE}/status/)
- [Data handling](${SITE}/privacy/)
- [Beta terms](${SITE}/terms/)

## Source and docs

- [GitHub repository](${REPO})
- [SECURITY.md](${REPO}/blob/main/SECURITY.md)
- [Documentation](${REPO}/tree/main/docs)
`;
}
