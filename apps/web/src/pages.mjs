import { connectAvailable, esc, statusTable } from './render.mjs';
import { LOCALES, SITE, locale, translator } from '../i18n/index.mjs';
import { BRAND_MARK, icon } from './icons.mjs';
import { COMPONENT_IDS, PILL_CLASS, STATES, STATUS_URL } from './status-data.mjs';

const REPO = 'https://github.com/AiReformator/postun';
const SUPPORT = 'https://t.me/postun_org';

/** Page ids and their path below a locale prefix. */
export const PAGES = { home: '/', useCases: '/use-cases/', status: '/status/', privacy: '/privacy/', terms: '/terms/', cabinet: '/app/' };

const DASHBOARD = (L) => `https://app.postun.org${L.prefix}/app/`;

/**
 * Cloudflare Web Analytics (cookieless page-view counter). The site token is public by design: it is visible in every page.
 * Only the official site loads it, so forks that change SITE send nothing to this account. Public pages only: the cabinet
 * never loads third-party code, and its own stricter CSP (public/_headers) blocks the beacon there in any case.
 */
export const WEB_ANALYTICS_TOKEN = SITE === 'https://postun.org' ? '82c68c9072b746318c16ba54d4689ccd' : '';
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
const beacon = () =>
  WEB_ANALYTICS_TOKEN ? `<script type="module" src="${BEACON_SRC}" data-cf-beacon='${JSON.stringify({ token: WEB_ANALYTICS_TOKEN, spa: false })}'></script>\n` : '';

/** Open Graph locale codes (language_TERRITORY). */
const OG_LOCALE = { en: 'en_US', ru: 'ru_RU', es: 'es_ES', pt: 'pt_BR', de: 'de_DE' };

function layout(L, page, { title, body, script, description, head = '', headerCta = '', analytics = true }) {
  const t = translator(L.dict);
  const href = (l) => `${l.prefix}${PAGES[page]}`;
  const alternates = LOCALES.map((l) => `<link rel="alternate" hreflang="${l.htmlLang}" href="${SITE}${href(l)}">`).join('\n');
  const switcher = LOCALES.map((l) =>
    l.code === L.code
      ? `<a data-lang="${l.code}" href="${href(l)}" lang="${l.htmlLang}" hreflang="${l.htmlLang}" aria-current="true" title="${esc(l.dict.meta.languageName)}">${l.short}</a>`
      : `<a data-lang="${l.code}" href="${href(l)}" lang="${l.htmlLang}" hreflang="${l.htmlLang}" title="${esc(l.dict.meta.languageName)}">${l.short}</a>`
  ).join('');
  const home = `${L.prefix}/`;
  return `<!doctype html>
<html lang="${L.htmlLang}" data-locale="${L.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f3ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c0d0f" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description ?? t('meta.description'))}">
<link rel="canonical" href="${SITE}${href(L)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Postun">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description ?? t('meta.description'))}">
<meta property="og:url" content="${SITE}${href(L)}">
<meta property="og:image" content="${SITE}/assets/postun-icon-256.png">
<meta property="og:locale" content="${OG_LOCALE[L.code]}">
${LOCALES.filter((l) => l.code !== L.code).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l.code]}">`).join('\n')}
<meta name="twitter:card" content="summary">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE}${PAGES[page]}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/host.js"></script>
${head}</head>
<body>
<a class="skip-link" href="#main">${t('nav.skip')}</a>
<header class="site-header"><div class="wrap">
<a class="brand" href="${home}">${BRAND_MARK}Postun <span class="badge">Beta</span></a>
<nav class="site-nav"><a href="${home}#how">${t('nav.how')}</a><a href="${L.prefix}/use-cases/"${page === 'useCases' ? ' aria-current="page"' : ''}>${t('useCases.navLabel')}</a><a href="${home}#connect">${t('nav.connect')}</a><a href="${home}#security">${t('nav.security')}</a><a href="${home}#features">${t('nav.features')}</a><a href="${L.prefix}/status/"${page === 'status' ? ' aria-current="page"' : ''}>${t('nav.status')}</a><a href="${home}#faq">${t('nav.faq')}</a><a class="nav-repo" href="${REPO}">GitHub</a></nav>
<details class="lang"><summary aria-label="${esc(t('nav.language'))}: ${esc(L.dict.meta.languageName)}">${icon('globe')}${L.short}${icon('chevron')}</summary>
<nav class="langs" aria-label="${esc(t('nav.language'))}">${switcher}</nav></details>
${headerCta}</div></header>
<main id="main" class="wrap">${body}</main>
<footer class="site-footer"><div class="wrap foot-grid">
<div class="foot-brand"><a class="brand" href="${home}">${BRAND_MARK}Postun</a><p>${t('footer.about')}</p></div>
<div class="foot-col"><h2>${t('footer.product')}</h2><ul><li><a href="${home}#how">${t('nav.how')}</a></li><li><a href="${L.prefix}/use-cases/">${t('useCases.navLabel')}</a></li><li><a href="${home}#features">${t('nav.features')}</a></li><li><a href="${home}#faq">${t('nav.faq')}</a></li><li><a href="${L.prefix}/status/">${t('footer.statusPage')}</a></li><li><a href="${DASHBOARD(L)}">${t('nav.app')}</a></li></ul></div>
<div class="foot-col"><h2>${t('footer.project')}</h2><ul><li><a href="${REPO}">${t('footer.source')}</a></li><li><a href="${REPO}/blob/main/SECURITY.md">${t('footer.vuln')}</a></li><li><a href="${REPO}/issues">${t('footer.issues')}</a></li><li><a href="${SUPPORT}">${t('footer.support')}</a></li></ul></div>
<div class="foot-col"><h2>${t('footer.legal')}</h2><ul><li><a href="${L.prefix}/terms/">${t('footer.terms')}</a></li><li><a href="${L.prefix}/privacy/">${t('footer.privacy')}</a></li></ul></div>
<p class="foot-note">${t('footer.issuesNote', { repo: REPO })}</p>
<p class="foot-note foot-tm">${t('footer.trademarks')}</p>
</div></footer>
${script ? `<script src="${script}" defer></script>` : ''}
${analytics ? beacon() : ''}</body>
</html>
`;
}

/** Plain text of a trusted dictionary string with markup: tags removed until none remain, then the few entities escHtml emits
 * decoded in ONE pass (so "&amp;lt;" becomes "&lt;", never "<"). Output goes only into JSON-LD, which escapes "</" separately. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
export function plainText(html) {
  let s = String(html);
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/<[^<>]*>/g, '');
  }
  s = s.replace(/[<>]/g, '');
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);
}

export const FAQ_COUNT = 8;

/** FAQ entries for a locale: answers are HTML (visible page) and plain text (JSON-LD). Claude Code wording follows status.json. */
export function faqItems(status, code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const claude = status.features.find((f) => f.id === 'mcp_claude_code')?.status === 'PASS' ? 'faq.claudeVerified' : 'faq.claudeTesting';
  const vars = { claudeState: t(claude), quota: Number(status.quota_daily_success ?? 10000).toLocaleString(L.htmlLang) };
  return Array.from({ length: FAQ_COUNT }, (_, i) => {
    const q = t(`faq.q${i + 1}`);
    const html = t(`faq.a${i + 1}`, vars);
    return { q, html, text: plainText(html) };
  });
}

/** JSON-LD for the landing: FAQPage (matches the visible FAQ) and SoftwareApplication. Safe to embed in a <script> data block. */
export function jsonLd(status, code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: L.htmlLang,
      mainEntity: faqItems(status, code).map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.text } }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Postun',
      description: plainText(t('landing.metaDescription')),
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      url: `${SITE}${L.prefix}/`,
      inLanguage: L.htmlLang,
      codeRepository: REPO,
      sameAs: [REPO],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
    }
  ];
  return data.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/<\//g, '<\\/')}</script>\n`).join('');
}


/** AI clients in the hero diagram: only clients with their own status.json entry (PASS → verified, else in testing). Others link to #connect. */
function clientList(status, t) {
  const st = Object.fromEntries(status.features.map((f) => [f.id, f.status]));
  const pill = (id) =>
    st[id] === 'PASS' ? `<span class="pill pill-ok">${t('landing.clientVerified')}</span>` : `<span class="pill pill-warn">${t('landing.clientTesting')}</span>`;
  return `<ul class="flow-clients">
<li>ChatGPT ${pill('mcp_chatgpt')}</li>
<li>Claude Code ${pill('mcp_claude_code')}</li>
<li class="more"><a href="#connect">${t('landing.clientOther')}</a></li>
</ul>`;
}

export const MCP_URL = 'https://mcp.postun.org/mcp';

/** The MCP address, front and centre. The copy button is revealed by host.js, so without JS there is no dead control. */
function endpoint(t) {
  return `<div class="endpoint">
<p class="endpoint-label" id="mcp-label">${icon('link')}${t('app.mcpLabel')}</p>
<div class="copy-field endpoint-field"><code aria-labelledby="mcp-label">${MCP_URL}</code><button type="button" class="btn btn-sm endpoint-copy" data-copy="${MCP_URL}" data-copied="${esc(plainText(t('app.copied')))}" hidden>${icon('copy')}<span>${t('app.copy')}</span></button></div>
<p class="endpoint-hint">${t('landing.mcpHint')}</p>
</div>`;
}


/** Compact JSON config, so it fits a phone screen: {"key": {"postun": {\n  ...fields\n}}} */
const MCP_JSON = (key, extra = {}) => {
  const fields = Object.entries({ ...extra, url: MCP_URL }).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{${JSON.stringify(key)}: {"postun": {\n${fields.join(',\n')}\n}}}`;
};

/**
 * MCP clients for the Connect section. `status` links a client to its status.json feature: only PASS puts it in
 * "verified on production"; every other client is listed as "supports the protocol, not tested by us".
 * Setup steps follow each client's own documentation (docs), checked 2026-11-06.
 */
export const CLIENTS = [
  { id: 'chatgpt', name: 'ChatGPT', status: 'mcp_chatgpt', code: MCP_URL, docs: 'https://developers.openai.com/plugins/deploy/connect-chatgpt' },
  { id: 'claudeCode', name: 'Claude Code', status: 'mcp_claude_code', code: `claude mcp add --transport http postun ${MCP_URL}`, docs: 'https://code.claude.com/docs/en/mcp' },
  { id: 'claudeAi', name: 'Claude', code: MCP_URL, docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp' },
  { id: 'cursor', name: 'Cursor', code: MCP_JSON('mcpServers'), docs: 'https://cursor.com/docs/context/mcp' },
  { id: 'vscode', name: 'VS Code · GitHub Copilot', code: MCP_JSON('servers', { type: 'http' }), docs: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration' },
  { id: 'gemini', name: 'Gemini CLI', code: `gemini mcp add --transport http postun ${MCP_URL}`, docs: 'https://geminicli.com/docs/tools/mcp-server/' },
  { id: 'codex', name: 'Codex CLI', code: `codex mcp add postun --url ${MCP_URL}\ncodex mcp login postun`, docs: 'https://developers.openai.com/codex/mcp' },
  { id: 'zed', name: 'Zed', code: MCP_JSON('context_servers'), docs: 'https://zed.dev/docs/ai/mcp' },
  { id: 'qwen', name: 'Qwen Code', code: `qwen mcp add --transport http postun ${MCP_URL}`, docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/' }
];

/** A code block with a copy button (revealed by host.js only where the Clipboard API exists). */
function snippet(code, t) {
  const kind = code.startsWith('{') ? 'json' : code.startsWith('https://') ? 'url' : 'terminal';
  return `<div class="snippet snippet-${kind}"><div class="snippet-bar"><span>${kind}</span><button type="button" class="btn btn-sm snippet-copy" data-copy="${esc(code)}" data-copied="${esc(plainText(t('app.copied')))}" hidden>${icon('copy')}<span>${t('app.copy')}</span></button></div><pre><code>${esc(code)}</code></pre></div>`;
}

/** ChatGPT Business / Enterprise: the admin adds the plugin once, reviews and publishes it; every member signs in alone. */
const CHATGPT_TEAM_STEPS = 5;
const CHATGPT_FORM_FIELDS = 5;
function chatgptWorkspace(t) {
  const list = (key, n) => Array.from({ length: n }, (_, i) => `<li>${t(`connect.${key}${i + 1}`)}</li>`).join('\n');
  return `<h4 class="client-sub">${t('connect.chatgptTeamTitle')}</h4>
<ol class="client-steps">
${list('chatgptTeam', CHATGPT_TEAM_STEPS)}
</ol>
<h4 class="client-sub">${t('connect.chatgptFormTitle')}</h4>
<ul class="client-steps">
${list('chatgptForm', CHATGPT_FORM_FIELDS)}
</ul>
<p class="note client-privacy">${t('connect.chatgptTeamPrivacy')}</p>`;
}

function connectSection(status, t) {
  const st = Object.fromEntries(status.features.map((f) => [f.id, f.status]));
  const verified = (c) => Boolean(c.status) && st[c.status] === 'PASS';
  const item = (c, ok) => `<details id="connect-${c.id.toLowerCase()}"><summary><span class="client-name">${esc(c.name)}</span>${ok ? `<span class="pill pill-ok">${t('landing.clientVerified')}</span>` : ''}</summary>
<div class="client-body"><p>${t(`connect.${c.id}`)}</p>${snippet(c.code, t)}${c.id === 'chatgpt' ? chatgptWorkspace(t) : ''}<p class="client-docs"><a href="${c.docs}">${t('connect.docs')}</a></p></div></details>`;
  const ok = CLIENTS.filter(verified);
  const rest = CLIENTS.filter((c) => !verified(c));
  return `<section id="connect" class="section faq connect">
<div class="section-head"><h2>${t('connect.title')}</h2><p>${t('connect.intro')}</p></div>
<div class="connect-groups">
<div class="connect-group"><h3 class="group-title">${t('connect.verified')}</h3><p class="note">${t('connect.verifiedNote')}</p>
<div class="faq-list">${ok.map((c) => item(c, true)).join('\n')}</div></div>
<div class="connect-group"><h3 class="group-title">${t('connect.protocol')}</h3><p class="note">${t('connect.protocolNote')}</p>
<div class="faq-list">${rest.map((c) => item(c, false)).join('\n')}</div></div>
</div>
</section>`;
}

/** Security facts, each checked against the code (see docs/03_SECURITY_PRIVACY.md). Labels are technical names, not translated. */
const SECURITY_LABELS = ['AES-256-GCM', 'HMAC-SHA-256', 'OAuth 2.1 · PKCE S256', 'TLS · HSTS · CSP', 'logs: off', 'Kerckhoffs · Apache-2.0'];
const SECURITY_ICONS = ['lock', 'eye', 'check', 'link', 'info', 'code'];
const SECURITY_MORE = 7;

function securitySection(t) {
  const items = SECURITY_LABELS.map((label, i) => `<li class="spec-item ticked"><p class="spec-label">${icon(SECURITY_ICONS[i])}<code>${esc(label)}</code></p><h3>${t(`security.s${i + 1}Title`)}</h3><p>${t(`security.s${i + 1}`)}</p></li>`).join('\n');
  const more = Array.from({ length: SECURITY_MORE }, (_, i) => `<li>${t(`security.m${i + 1}`)}</li>`).join('\n');
  return `<section id="security" class="section">
<div class="section-head"><h2>${t('security.title')}</h2><p>${t('security.intro')}</p></div>
<ul class="spec">
${items}
</ul>
<div class="spec-more"><h3>${t('security.moreTitle')}</h3><ul>
${more}
</ul></div>
<p class="note spec-note">${t('security.note')}</p>
</section>`;
}

export function landing(status, code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const open = connectAvailable(status);
  const quota = Number(status.quota_daily_success ?? 10000).toLocaleString(L.htmlLang);
  const ctaLink = (cls = 'btn') => `<a class="${cls}" href="${DASHBOARD(L)}">${t('landing.cta')}${icon('arrow')}</a>`;
  const cta = open
    ? `<div class="btn-row">${ctaLink()}<a class="btn secondary" href="#how">${t('landing.ctaSecondary')}</a></div>`
    : `<div class="btn-row"><button class="btn" disabled aria-describedby="cta-note">${t('landing.cta')}</button><a class="btn secondary" href="#how">${t('landing.ctaSecondary')}</a></div>
<p id="cta-note" class="note cta-note">${t('landing.ctaClosed')}</p>`;
  const usp = (i, ico, extra = '', cls = 'usp ticked') =>
    `<li class="${cls}"><span class="usp-ico">${icon(ico)}</span><h3>${t(`landing.usp${i}Title`)}</h3>${extra}<p>${i === 6 ? t('landing.quota', { quota }) : t(`landing.usp${i}`)}</p></li>`;
  const step = (i) => `<li><h3>${t(`landing.step${i}Title`)}</h3><p>${t(`landing.step${i}`)}</p></li>`;
  return layout(L, 'home', {
    title: t('landing.title'),
    description: t('landing.metaDescription'),
    head: jsonLd(status, code),
    headerCta: open ? `<a class="btn header-cta" href="${DASHBOARD(L)}">${t('nav.app')}</a>` : '',
    body: `
<section class="hero">
<div class="hero-copy">
<p class="eyebrow">${t('landing.eyebrow')}</p>
<h1>Connected, not collected.</h1>
<p class="tagline">${t('landing.subtitle')}</p>
${endpoint(t)}
<p class="lead">${t('landing.lead')}</p>
${cta}
<ul class="chips">
<li>${icon('check')}${t('landing.trust1')}</li>
<li>${icon('check')}${t('landing.trust2')}</li>
<li>${icon('check')}${t('landing.trust3')}</li>
</ul>
</div>
<figure class="flow ticked" aria-label="${esc(plainText(t('landing.flowLabel')))}">
<div class="flow-node"><span class="flow-ico flow-tg"><img src="/assets/telegram.svg" alt="" width="44" height="44"></span><strong>${t('landing.flowYou')}</strong><small>${t('landing.flowYouNote')}</small></div>
<div class="flow-link" aria-hidden="true"></div>
<div class="flow-node flow-core"><span class="flow-ico">${BRAND_MARK}</span><strong>Postun</strong><small>${t('landing.flowCoreNote')}</small></div>
<div class="flow-link" aria-hidden="true"></div>
<p class="flow-caption">${icon('spark')}${t('landing.flowAi')}</p>
${clientList(status, t)}
</figure>
</section>

<section id="why" class="section">
<div class="section-head"><h2>${t('landing.uspTitle')}</h2></div>
<ul class="usp-grid">
${usp(1, 'qr', '', 'usp usp-lead ticked')}
${usp(2, 'spark')}
${usp(3, 'eye')}
${usp(4, 'lock')}
${usp(5, 'code')}
${usp(6, 'gift', `<p class="usp-figure">${esc(quota)}</p>`)}
</ul>
</section>

<section id="how" class="section">
<div class="section-head"><h2>${t('landing.howTitle')}</h2></div>
<ol class="steps">
${[1, 2, 3, 4].map(step).join('\n')}
</ol>
</section>

<section id="use" class="section">
<div class="section-head"><h2>${t('useCases.teaserTitle')}</h2><p>${t('useCases.teaserText')}</p></div>
<ul class="uc-teaser">
${USE_CASE_GROUPS.map((g) => `<li><a href="${L.prefix}/use-cases/#${g.id}">${icon(g.icon)}<span>${t(`useCases.${g.key}Title`)}</span></a></li>`).join('\n')}
</ul>
<p><a class="btn secondary" href="${L.prefix}/use-cases/">${t('useCases.teaserLink')}${icon('arrow')}</a></p>
</section>

${connectSection(status, t)}

${securitySection(t)}

<section id="features" class="section">
<div id="status" class="status-grid">
<div class="status-intro section-head">
<h2>${t('landing.statusTitle')}</h2>
<p>${t('landing.can')}</p>
<p class="note">${t('landing.statusNote', { updated: status.updated })}</p>
</div>
<div class="table-wrap">${statusTable(status, L.dict)}</div>
</div>
</section>

<section id="open">
<div class="section"><div class="band">
<h2>${t('landing.openTitle')}</h2>
<p>${t('landing.open', { repo: REPO })}</p>
<a class="btn" href="${REPO}">${icon('code')}${t('landing.openCta')}</a>
</div></div>
</section>

<section id="faq" class="section faq">
<div class="section-head"><h2>${t('faq.title')}</h2></div>
<div class="faq-list">
${faqItems(status, code).map((f) => `<details><summary>${f.q}</summary><p>${f.html}</p></details>`).join('\n')}
</div>
</section>

<section class="section">
<div class="final ticked">
<h2>${t('landing.finalTitle')}</h2>
<p>${t('landing.finalText')}</p>
${open ? ctaLink() : ''}
</div>
</section>`
  });
}

/**
 * Use cases (/use-cases/): groups of scenarios, each with the Postun tools it relies on. Tool names are the real MCP tool
 * names (apps/mcp/src/schemas.ts); the texts live in i18n/use-cases/<locale>.mjs. USE_CASE_COUNT is part of the titles.
 */
export const USE_CASE_GROUPS = [
  { id: 'analytics', key: 'g1', icon: 'eye', items: [
    { n: 1, tools: ['search_channels', 'get_channel_posts'] },
    { n: 2, tools: ['search_channels', 'get_channel_posts'] },
    { n: 3, tools: ['search_messages', 'get_channel_posts'] }
  ] },
  { id: 'digests', key: 'g2', icon: 'spark', items: [
    { n: 4, tools: ['list_dialogs', 'get_channel_posts'] },
    { n: 5, tools: ['list_dialogs', 'get_history'] },
    { n: 6, tools: ['get_history'] }
  ] },
  { id: 'work', key: 'g3', icon: 'check', items: [
    { n: 7, tools: ['get_history'] },
    { n: 8, tools: ['list_dialogs', 'get_history'] },
    { n: 9, tools: ['search_messages', 'get_history'] },
    { n: 10, tools: ['get_history', 'search_messages'] }
  ] },
  { id: 'communities', key: 'g4', icon: 'globe', items: [
    { n: 11, tools: ['get_history', 'search_messages'] },
    { n: 12, tools: ['get_history', 'search_messages'] },
    { n: 13, tools: ['search_channels', 'get_channel_posts'] }
  ] },
  { id: 'search', key: 'g5', icon: 'link', items: [
    { n: 14, tools: ['search_messages', 'get_media_info', 'get_media'] },
    { n: 15, tools: ['search_messages', 'get_channel_posts'] }
  ] },
  { id: 'developers', key: 'g6', icon: 'code', items: [{ n: 16, tools: ['get_history', 'search_messages', 'get_media'] }] }
];
export const USE_CASE_COUNT = USE_CASE_GROUPS.reduce((n, g) => n + g.items.length, 0);
export const USE_CASE_NOTS = 6;
export const USE_CASE_NOTES = 7;
export const USE_CASE_FAQ = 4;

/** FAQ of the use-cases page: HTML for the page, plain text for JSON-LD. */
export function useCaseFaq(code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  return Array.from({ length: USE_CASE_FAQ }, (_, i) => {
    const html = t(`useCases.fa${i + 1}`, { home: `${L.prefix}/` });
    return { q: t(`useCases.fq${i + 1}`), html, text: plainText(html) };
  });
}

/** JSON-LD for the use-cases page: breadcrumbs, the page with its list of use cases, and the FAQ shown on it. */
export function useCasesJsonLd(code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const url = `${SITE}${L.prefix}${PAGES.useCases}`;
  const items = USE_CASE_GROUPS.flatMap((g) => g.items).map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: `${url}#use-case-${it.n}`,
    name: plainText(t(`useCases.u${it.n}.title`)),
    description: plainText(t(`useCases.u${it.n}.text`))
  }));
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: plainText(t('useCases.breadcrumbHome')), item: `${SITE}${L.prefix}/` },
        { '@type': 'ListItem', position: 2, name: plainText(t('useCases.eyebrow')), item: url }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: plainText(t('useCases.h1')),
      description: plainText(t('useCases.metaDescription')),
      url,
      inLanguage: L.htmlLang,
      isPartOf: { '@type': 'WebSite', name: 'Postun', url: `${SITE}/` },
      about: { '@type': 'SoftwareApplication', name: 'Postun', url: `${SITE}${L.prefix}/`, applicationCategory: 'DeveloperApplication', operatingSystem: 'Web' },
      mainEntity: { '@type': 'ItemList', numberOfItems: items.length, itemListElement: items }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: L.htmlLang,
      mainEntity: useCaseFaq(code).map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.text } }))
    }
  ];
  return data.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/<\//g, '<\\/')}</script>\n`).join('');
}

export function useCasesPage(status, code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const home = `${L.prefix}/`;
  const quota = Number(status.quota_daily_success ?? 10000).toLocaleString(L.htmlLang);
  const open = connectAvailable(status);
  const toc = USE_CASE_GROUPS.map((g) => `<li><a href="#${g.id}">${t(`useCases.${g.key}Title`)}</a></li>`).join('');
  const card = (it) => `<li class="uc-card ticked" id="use-case-${it.n}">
<h3>${t(`useCases.u${it.n}.title`)}</h3>
<p>${t(`useCases.u${it.n}.text`)}</p>
<div class="uc-prompts"><p class="uc-label">${t('useCases.promptLabel')}</p>
<blockquote class="uc-prompt"><p>${t(`useCases.u${it.n}.p1`)}</p></blockquote>
<blockquote class="uc-prompt"><p>${t(`useCases.u${it.n}.p2`)}</p></blockquote></div>
<p class="uc-limit"><strong>${t('useCases.limitLabel')}:</strong> ${t(`useCases.u${it.n}.limit`)}</p>
<p class="uc-tools"><span class="visually-hidden">${t('useCases.toolsLabel')}: </span>${it.tools.map((x) => `<code>${x}</code>`).join(' ')}</p>
</li>`;
  const groups = USE_CASE_GROUPS.map(
    (g) => `<section id="${g.id}" class="section uc-group">
<div class="section-head"><h2>${t(`useCases.${g.key}Title`)}</h2><p>${t(`useCases.${g.key}Intro`)}</p></div>
<ul class="uc-grid">
${g.items.map(card).join('\n')}
</ul>
</section>`
  ).join('\n\n');
  const list = (prefix, n, vars = {}) => Array.from({ length: n }, (_, i) => `<li>${t(`useCases.${prefix}${i + 1}`, vars)}</li>`).join('\n');
  const cta = open
    ? `<a class="btn" href="${DASHBOARD(L)}">${t('landing.cta')}${icon('arrow')}</a>`
    : `<a class="btn" href="${home}#connect">${t('useCases.finalHome')}${icon('arrow')}</a>`;
  return layout(L, 'useCases', {
    title: t('useCases.title'),
    description: t('useCases.metaDescription'),
    head: useCasesJsonLd(code),
    headerCta: open ? `<a class="btn header-cta" href="${DASHBOARD(L)}">${t('nav.app')}</a>` : '',
    body: `
<header class="uc-head">
<nav class="crumbs" aria-label="${esc(plainText(t('useCases.breadcrumbLabel')))}"><ol><li><a href="${home}">${t('useCases.breadcrumbHome')}</a></li><li><span aria-current="page">${t('useCases.eyebrow')}</span></li></ol></nav>
<p class="eyebrow">${t('useCases.eyebrow')}</p>
<h1>${t('useCases.h1')}</h1>
<p class="lead">${t('useCases.lead')}</p>
<nav class="uc-toc" aria-label="${esc(plainText(t('useCases.tocLabel')))}"><ul>${toc}</ul></nav>
</header>

<section id="start" class="section">
<div class="section-head"><h2>${t('useCases.howTitle')}</h2></div>
<ol class="steps steps-3">
${[1, 2, 3].map((i) => `<li><p>${t(`useCases.how${i}`, { home })}</p></li>`).join('\n')}
</ol>
</section>

${groups}

<section id="limits" class="section">
<div class="uc-not">
<h2>${t('useCases.notTitle')}</h2>
<ul>
${list('not', USE_CASE_NOTS)}
</ul>
</div>
<div class="uc-notes">
<h2>${t('useCases.notesTitle')}</h2>
<ul>
${list('note', USE_CASE_NOTES, { quota, privacy: `${L.prefix}/privacy/` })}
</ul>
</div>
</section>

<section id="faq" class="section faq">
<div class="section-head"><h2>${t('useCases.faqTitle')}</h2></div>
<div class="faq-list">
${useCaseFaq(code).map((f) => `<details><summary>${f.q}</summary><p>${f.html}</p></details>`).join('\n')}
</div>
</section>

<section class="section">
<div class="final ticked">
<h2>${t('useCases.finalTitle')}</h2>
<p>${t('useCases.finalText')}</p>
${cta}
</div>
</section>`
  });
}

/** JSON for a <script type="application/json"> data block: "<" is escaped so it can never close the tag. */
const dataBlock = (id, obj) => `<script type="application/json" id="${id}">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

/**
 * Public status page. The server renders the whole skeleton (title, intro, component names, legend) so it works without
 * JavaScript; assets/status.js fetches STATUS_URL and fills in the live state. Strings for the script travel as a JSON data
 * block (inert under CSP), so the bundle carries no dictionaries.
 */
export function statusPage(code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const comps = COMPONENT_IDS.map(
    (id) => `<li class="status-comp" data-component="${id}">
<div class="status-comp-head"><h2>${t(`statusPage.comp.${id}`)}</h2><span class="pill pill-unknown" data-role="pill">${t('statusPage.state.unknown')}</span></div>
<div class="status-comp-body" data-role="body" hidden></div>
</li>`
  ).join('\n');
  const legend = STATES.map((s) => `<li><span class="pill ${PILL_CLASS[s]}">${t(`statusPage.state.${s}`)}</span><span>${t(`statusPage.legend.${s}`)}</span></li>`).join('\n');
  return layout(L, 'status', {
    title: t('statusPage.title'),
    description: t('statusPage.metaDescription'),
    script: '/assets/status.js',
    body: `<article class="status-page">
<header class="status-head">
<h1>${t('statusPage.h1')}</h1>
<p class="lead">${t('statusPage.intro')}</p>
</header>
<div id="status-root" data-src="${STATUS_URL}">
<div class="status-banner is-unknown" id="status-banner">
<span class="status-banner-ico">${icon('pulse')}</span>
<div><p class="status-banner-title" id="status-title" role="status"><noscript>${t('statusPage.noscript')}</noscript></p><p class="status-banner-text note" id="status-text"></p></div>
</div>
<ul class="status-list" id="status-components">
${comps}
</ul>
<section class="status-incidents" aria-labelledby="inc-title" id="status-incidents-section" hidden>
<h2 id="inc-title">${t('statusPage.incidentsTitle')}</h2>
<ul class="status-incident-list" id="status-incidents"></ul>
</section>
</div>
<section class="status-legend" aria-labelledby="legend-title">
<h2 id="legend-title">${t('statusPage.legendTitle')}</h2>
<ul>
${legend}
</ul>
</section>
${dataBlock('status-i18n', L.dict.statusPage)}
</article>`
  });
}

function translationNote(t) {
  const n = t('legal.translationNote');
  return n ? `<p class="note translation">${n}</p>` : '';
}

export function privacy(code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<tr><td>${t(`privacy.r${i}a`)}</td><td>${t(`privacy.r${i}b`)}</td></tr>`).join('\n');
  return layout(L, 'privacy', {
    title: t('privacy.title'),
    body: `<article class="doc">
<h1>${t('privacy.h1')}</h1>
${translationNote(t)}
<p class="note">${t('privacy.edition')}</p>
<div class="table-wrap"><table class="status"><thead><tr><th>${t('privacy.category')}</th><th>${t('privacy.policy')}</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p>${t('privacy.p1')}</p>
<p>${t('privacy.p2')}</p>
<p>${t('privacy.p3')}</p>
<p>${t('privacy.p4')}</p>
</article>`
  });
}

export function terms(code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  return layout(L, 'terms', {
    title: t('terms.title'),
    body: `<article class="doc">
<h1>${t('terms.h1')}</h1>
${translationNote(t)}
<ul class="terms">
${[1, 2, 3, 4, 5, 6].map((i) => `<li>${t(`terms.t${i}`)}</li>`).join('\n')}
</ul>
</article>`
  });
}

export function cabinet(status, code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  return layout(L, 'cabinet', {
    title: t('cabinet.title'),
    script: '/assets/app.js',
    analytics: false,
    body: `<section class="cab">
<div class="cab-head"><h1>${t('cabinet.h1')} <span class="badge">Beta</span></h1></div>
<div id="app" data-auth="https://auth.postun.org" data-registration="${status.registration_open ? 'open' : 'closed'}" aria-live="polite">
<p class="note">${t('cabinet.loading')}</p>
<noscript><p>${t('cabinet.noscript')}</p></noscript>
</div>
</section>`
  });
}
