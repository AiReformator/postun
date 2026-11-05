import { connectAvailable, esc, statusTable } from './render.mjs';
import { LOCALES, SITE, locale, translator } from '../i18n/index.mjs';

const REPO = 'https://github.com/AiReformator/postun';

/** Page ids and their path below a locale prefix. */
export const PAGES = { home: '/', privacy: '/privacy/', terms: '/terms/', cabinet: '/app/' };

function layout(L, page, { title, body, script }) {
  const t = translator(L.dict);
  const href = (l) => `${l.prefix}${PAGES[page]}`;
  const alternates = LOCALES.map((l) => `<link rel="alternate" hreflang="${l.htmlLang}" href="${SITE}${href(l)}">`).join('\n');
  const switcher = LOCALES.map((l) =>
    l.code === L.code
      ? `<a data-lang="${l.code}" href="${href(l)}" lang="${l.htmlLang}" hreflang="${l.htmlLang}" aria-current="true">${l.short}</a>`
      : `<a data-lang="${l.code}" href="${href(l)}" lang="${l.htmlLang}" hreflang="${l.htmlLang}" title="${esc(l.dict.meta.languageName)}">${l.short}</a>`
  ).join('');
  const home = `${L.prefix}/`;
  return `<!doctype html>
<html lang="${L.htmlLang}" data-locale="${L.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(t('meta.description'))}">
<link rel="canonical" href="${SITE}${href(L)}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE}${PAGES[page]}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/host.js"></script>
</head>
<body>
<header class="top"><div class="wrap row">
<a class="brand" href="${home}">Postun <span class="badge">Beta</span></a>
<nav><a href="${home}#how">${t('nav.how')}</a><a href="${home}#status">${t('nav.status')}</a><a href="${L.prefix}/privacy/">${t('nav.data')}</a><a href="${REPO}">GitHub</a></nav>
<nav class="langs" aria-label="${esc(t('nav.language'))}">${switcher}</nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="wrap foot">
<p>${t('footer.about')}</p>
<p><a href="${REPO}">${t('footer.source')}</a> · <a href="${REPO}/blob/main/SECURITY.md">${t('footer.vuln')}</a> · <a href="${L.prefix}/terms/">${t('footer.terms')}</a> · <a href="${L.prefix}/privacy/">${t('footer.privacy')}</a></p>
</footer>
${script ? `<script src="${script}" defer></script>` : ''}
</body>
</html>
`;
}

export function landing(status, code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const open = connectAvailable(status);
  const cta = open
    ? `<a class="btn" href="https://app.postun.org${L.prefix}/app/">${t('landing.cta')}</a>`
    : `<button class="btn" disabled aria-describedby="cta-note">${t('landing.cta')}</button>
<p id="cta-note" class="note">${t('landing.ctaClosed')}</p>`;
  return layout(L, 'home', {
    title: t('landing.title'),
    body: `
<section class="hero">
<p class="eyebrow">${t('landing.eyebrow')}</p>
<h1>Connected, not collected.</h1>
<p class="lead">${t('landing.lead')}</p>
${cta}
</section>

<section id="how" class="grid">
<article><h2>${t('landing.step1Title')}</h2><p>${t('landing.step1')}</p></article>
<article><h2>${t('landing.step2Title')}</h2><p>${t('landing.step2')}</p></article>
<article><h2>${t('landing.step3Title')}</h2><p>${t('landing.step3')}</p></article>
<article><h2>${t('landing.step4Title')}</h2><p>${t('landing.step4')}</p></article>
</section>

<section>
<h2>${t('landing.canTitle')}</h2>
<p>${t('landing.can')}</p>
<p>${t('landing.quota', { quota: String(status.quota_success ?? 100) })}</p>
</section>

<section id="status">
<h2>${t('landing.statusTitle')}</h2>
<p class="note">${t('landing.statusNote', { updated: status.updated })}</p>
${statusTable(status, L.dict)}
</section>

<section>
<h2>${t('landing.dataTitle')}</h2>
<ul>
<li>${t('landing.data1')}</li>
<li>${t('landing.data2')}</li>
<li>${t('landing.data3')}</li>
<li>${t('landing.data4')}</li>
</ul>
<p><a href="${L.prefix}/privacy/">${t('landing.dataMore')}</a></p>
</section>

<section>
<h2>${t('landing.feedbackTitle')}</h2>
<p>${t('landing.feedback', { repo: REPO })}</p>
</section>`
  });
}

function translationNote(t) {
  const n = t('legal.translationNote');
  return n ? `<p class="note">${n}</p>` : '';
}

export function privacy(code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<tr><td>${t(`privacy.r${i}a`)}</td><td>${t(`privacy.r${i}b`)}</td></tr>`).join('\n');
  return layout(L, 'privacy', {
    title: t('privacy.title'),
    body: `<h1>${t('privacy.h1')}</h1>
${translationNote(t)}
<p class="note">${t('privacy.edition')}</p>
<table class="status"><thead><tr><th>${t('privacy.category')}</th><th>${t('privacy.policy')}</th></tr></thead><tbody>
${rows}
</tbody></table>
<p>${t('privacy.p1')}</p>
<p>${t('privacy.p2')}</p>
<p>${t('privacy.p3')}</p>`
  });
}

export function terms(code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  return layout(L, 'terms', {
    title: t('terms.title'),
    body: `<h1>${t('terms.h1')}</h1>
${translationNote(t)}
<ul>
${[1, 2, 3, 4, 5, 6].map((i) => `<li>${t(`terms.t${i}`)}</li>`).join('\n')}
</ul>`
  });
}

export function cabinet(status, code = 'en') {
  const L = locale(code);
  const t = translator(L.dict);
  return layout(L, 'cabinet', {
    title: t('cabinet.title'),
    script: '/assets/app.js',
    body: `<h1>${t('cabinet.h1')} <span class="badge">Beta</span></h1>
<div id="app" data-auth="https://auth.postun.org" data-registration="${status.registration_open ? 'open' : 'closed'}">
<p class="note">${t('cabinet.loading')}</p>
<noscript><p>${t('cabinet.noscript')}</p></noscript>
</div>`
  });
}
