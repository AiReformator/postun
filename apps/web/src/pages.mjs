import { connectAvailable, esc, statusTable } from './render.mjs';
import { LOCALES, SITE, locale, translator } from '../i18n/index.mjs';
import { BRAND_MARK, icon } from './icons.mjs';

const REPO = 'https://github.com/AiReformator/postun';

/** Page ids and their path below a locale prefix. */
export const PAGES = { home: '/', privacy: '/privacy/', terms: '/terms/', cabinet: '/app/' };

const DASHBOARD = (L) => `https://app.postun.org${L.prefix}/app/`;

function layout(L, page, { title, body, script, description, head = '', headerCta = '' }) {
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
<nav class="site-nav"><a href="${home}#how">${t('nav.how')}</a><a href="${home}#status">${t('nav.status')}</a><a href="${home}#faq">${t('nav.faq')}</a><a href="${REPO}">GitHub</a></nav>
<details class="lang"><summary aria-label="${esc(t('nav.language'))}: ${esc(L.dict.meta.languageName)}">${icon('globe')}${L.short}${icon('chevron')}</summary>
<nav class="langs" aria-label="${esc(t('nav.language'))}">${switcher}</nav></details>
${headerCta}</div></header>
<main id="main" class="wrap">${body}</main>
<footer class="site-footer"><div class="wrap foot-grid">
<div class="foot-brand"><a class="brand" href="${home}">${BRAND_MARK}Postun</a><p>${t('footer.about')}</p></div>
<div class="foot-col"><h2>${t('footer.product')}</h2><ul><li><a href="${home}#how">${t('nav.how')}</a></li><li><a href="${home}#status">${t('nav.status')}</a></li><li><a href="${home}#faq">${t('nav.faq')}</a></li><li><a href="${DASHBOARD(L)}">${t('nav.app')}</a></li></ul></div>
<div class="foot-col"><h2>${t('footer.project')}</h2><ul><li><a href="${REPO}">${t('footer.source')}</a></li><li><a href="${REPO}/blob/main/SECURITY.md">${t('footer.vuln')}</a></li><li><a href="${REPO}/issues">${t('footer.issues')}</a></li></ul></div>
<div class="foot-col"><h2>${t('footer.legal')}</h2><ul><li><a href="${L.prefix}/terms/">${t('footer.terms')}</a></li><li><a href="${L.prefix}/privacy/">${t('footer.privacy')}</a></li></ul></div>
<p class="foot-note">${t('footer.issuesNote', { repo: REPO })}</p>
</div></footer>
${script ? `<script src="${script}" defer></script>` : ''}
</body>
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

export const FAQ_COUNT = 7;

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


/** AI clients in the hero diagram. Compatibility is claimed only from status.json: PASS → verified, anything else → in testing. */
function clientList(status, t) {
  const st = Object.fromEntries(status.features.map((f) => [f.id, f.status]));
  const pill = (id) =>
    st[id] === 'PASS' ? `<span class="pill pill-ok">${t('landing.clientVerified')}</span>` : `<span class="pill pill-warn">${t('landing.clientTesting')}</span>`;
  return `<ul class="flow-clients">
<li>ChatGPT ${pill('mcp_chatgpt')}</li>
<li>Claude ${pill('mcp_claude_code')}</li>
<li>Claude Code ${pill('mcp_claude_code')}</li>
<li class="more">${t('landing.clientOther')}</li>
</ul>`;
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
  const usp = (i, ico, extra = '', cls = 'usp') =>
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
<p class="lead">${t('landing.lead')}</p>
${cta}
<ul class="chips">
<li>${icon('check')}${t('landing.trust1')}</li>
<li>${icon('check')}${t('landing.trust2')}</li>
<li>${icon('check')}${t('landing.trust3')}</li>
</ul>
</div>
<figure class="flow" aria-label="${esc(plainText(t('landing.flowLabel')))}">
<div class="flow-node"><span class="flow-ico">${icon('phone')}</span><strong>${t('landing.flowYou')}</strong><small>${t('landing.flowYouNote')}</small></div>
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
${usp(1, 'qr', '', 'usp usp-lead')}
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

<section id="status" class="section">
<div class="status-grid">
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
<div class="final">
<h2>${t('landing.finalTitle')}</h2>
<p>${t('landing.finalText')}</p>
${open ? ctaLink() : ''}
</div>
</section>`
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
    body: `<section class="cab">
<div class="cab-head"><h1>${t('cabinet.h1')} <span class="badge">Beta</span></h1></div>
<div id="app" data-auth="https://auth.postun.org" data-registration="${status.registration_open ? 'open' : 'closed'}" aria-live="polite">
<p class="note">${t('cabinet.loading')}</p>
<noscript><p>${t('cabinet.noscript')}</p></noscript>
</div>
</section>`
  });
}
