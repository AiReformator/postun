// Postun Beta cabinet. Talks only to the auth origin with credentialed fetch; holds no tokens in storage.
// All server text is inserted with textContent (no innerHTML with dynamic data).
import { encodeQR } from 'qr';
import { ICONS } from './icons.mjs';
import { createApi } from './api.mjs';
import { continueFromHash, continueStore, continueUrl } from './continue.mjs';
import en from '../i18n/en.mjs';
import ru from '../i18n/ru.mjs';
import es from '../i18n/es.mjs';
import pt from '../i18n/pt.mjs';
import de from '../i18n/de.mjs';

const root = document.getElementById('app');
const AUTH = root.dataset.auth;
const LOCALE = document.documentElement.dataset.locale || 'en';
const S = ({ en, ru, es, pt, de }[LOCALE] || en).app;
/** Hand the cabinet language to the auth Worker (it renders its own pages). */
const withLang = (u) => {
  try {
    const x = new URL(u, location.href);
    x.searchParams.set('lang', LOCALE);
    return x.href;
  } catch {
    return u;
  }
};
/** Cabinet text is inserted with textContent, so {vars} are substituted without HTML escaping. */
/**
 * A pending AI-client sign-in handed over by the auth Worker as `#continue=` (see continue.mjs). Read before anything
 * async, kept for this tab only, and removed from the address bar at once so it is not bookmarked or shared.
 */
let sessionStore = null;
try {
  sessionStore = window.sessionStorage;
} catch {
  /* storage blocked: the target lives in memory for this page view only */
}
const CONT = continueStore(sessionStore ?? { getItem: () => null, setItem() {}, removeItem() {} });
let memoContinue = null;
if (location.hash.startsWith('#continue=')) {
  memoContinue = continueFromHash(location.hash);
  if (memoContinue) CONT.save(memoContinue);
  try {
    window.history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* the fragment stays visible; it is never sent anywhere */
  }
}
const pendingContinue = () => CONT.load() ?? memoContinue;
const dropContinue = () => {
  CONT.clear();
  memoContinue = null;
};
/** User-initiated only: returns to the auth origin, where /authorize re-validates the whole request. */
function resumeClient() {
  const href = continueUrl(AUTH, pendingContinue());
  dropContinue();
  if (href) location.assign(href);
  else main();
}
const continueButton = () => el('button', { class: 'btn', type: 'button', onclick: resumeClient }, T('connectContinue'), icon('arrow'));

const T = (key, vars = {}) => String(S[key]).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
let csrf = '';

const SCOPE_TITLES = S.scopes;
const LINK_ERRORS = S.linkErrors;

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const api = createApi({ base: AUTH, locale: LOCALE, t: T, linkErrors: LINK_ERRORS, csrf: () => csrf });

function show(...nodes) {
  root.replaceChildren(...nodes);
}

function errorBox(e) {
  return el('p', { class: 'err', role: 'alert' }, e.message || T('error'));
}

const SVG = 'http://www.w3.org/2000/svg';
/** Decorative icon from the constant icon set (parsed as SVG, never from server data). */
function icon(name) {
  const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG}" viewBox="0 0 24 24">${ICONS[name]}</svg>`, 'image/svg+xml');
  const node = document.importNode(doc.documentElement, true);
  node.setAttribute('class', 'icon');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  return node;
}

const NUM = new Intl.NumberFormat(document.documentElement.lang || 'en');
const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? NUM.format(n) : String(n ?? '—'));
function bytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '—');
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: 1 }).format(n);
}

function card(title, ...children) {
  return el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', {}, title)), ...children);
}

/** A focused single-task panel (sign-in, QR, password, results). */
function panel(...children) {
  return el('section', { class: 'card auth-card' }, ...children);
}

function qrNode(text) {
  const svg = encodeQR(text, 'svg', { ecc: 'medium', border: 1 });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const node = document.importNode(doc.documentElement, true);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', T('qrAria'));
  return el('div', { class: 'qr' }, node);
}

async function main() {
  let s;
  try {
    s = await api('/api/session');
  } catch {
    show(el('p', { class: 'err' }, T('serviceDown')));
    return;
  }
  if (!s.authenticated) {
    // The sign-in that sent the user here is gone (session expired or signed out): it has to start again in the client.
    const expired = pendingContinue() ? el('p', { class: 'notice' }, icon('info'), el('span', {}, T('connectSessionExpired'))) : '';
    dropContinue();
    const btn = s.registrationOpen
      ? el('a', { class: 'btn', href: withLang(s.loginUrl) }, T('login'), icon('arrow'))
      : el('button', { class: 'btn', disabled: '' }, T('login'));
    const note = s.registrationOpen ? '' : el('p', { class: 'note' }, T('registrationClosed'));
    show(panel(expired, el('span', { class: 'usp-ico' }, icon('lock')), el('p', {}, T('loginIntro')), btn, note));
    return;
  }
  csrf = s.csrfToken;
  if (s.termsRequired) {
    show(panel(el('p', {}, T('termsIntro')), el('a', { class: 'btn', href: withLang(s.termsUrl) }, T('termsOpen'), icon('arrow'))));
    return;
  }
  await renderDashboard();
}

async function renderDashboard() {
  const [acc, grants, usage] = await Promise.all([
    api('/api/accounts').catch((e) => ({ error: e })),
    api('/api/grants').catch((e) => ({ error: e })),
    api('/api/usage').catch((e) => ({ error: e }))
  ]);

  const sections = [];
  sections.push(el('p', { class: 'notice' }, icon('info'), el('span', {}, T('betaNote'))));

  // An AI client is waiting for this user to link a Telegram account.
  if (pendingContinue()) {
    const ready = (acc.accounts || []).some((a) => a.status === 'active');
    const resume = card(T('connectTitle'),
      el('p', {}, T(ready ? 'connectReady' : 'connectNeedAccount')),
      el('div', { class: 'btn-row' }, ready ? continueButton() : el('button', { class: 'btn', type: 'button', onclick: () => startLink() }, icon('qr'), T('linkQr')))
    );
    resume.classList.add('span-2');
    sections.push(resume);
  }

  // Quota
  const u = usage.usage;
  const limit = u ? u.dailySuccessLimit ?? u.monthlySuccessLimit : 0;
  sections.push(
    card(T('quotaTitle'),
      ...(u
        ? [
            el('p', { class: 'field-label' }, T('quotaToday', { day: u.day })),
            el('p', { class: 'meter-figure' }, el('strong', {}, fmt(u.daySuccessCount)), el('span', {}, `/ ${fmt(limit)}`)),
            el('progress', { class: 'meter', max: String(limit || 1), value: String(Math.min(u.daySuccessCount || 0, limit || 1)), 'aria-label': T('quotaTitle') }),
            el('p', { class: 'note' }, T('quota', { day: u.day, used: fmt(u.daySuccessCount), limit: fmt(limit), monthUsed: fmt(u.successCount), bytes: bytes(u.outBytes) }))
          ]
        : [errorBox(usage.error)])
    )
  );

  // MCP address
  const MCP_URL = 'https://mcp.postun.org/mcp';
  const copyBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('copy'), T('copy'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      copyBtn.replaceChildren(icon('check'), T('copied'));
      setTimeout(() => copyBtn.replaceChildren(icon('copy'), T('copy')), 2000);
    } catch {
      /* clipboard unavailable: the address stays visible and selectable */
    }
  });
  sections.push(
    card(T('mcpLabel'),
      el('div', { class: 'copy-field' }, el('code', {}, MCP_URL), copyBtn),
      el('p', { class: 'note' }, T('mcpNote'))
    )
  );

  // Accounts
  const statusPill = (st) =>
    st === 'active' ? el('span', { class: 'pill pill-ok' }, T('accActive')) : st === 'pending' ? el('span', { class: 'pill pill-warn' }, T('accPending')) : el('span', { class: 'pill' }, String(st));
  const accList = el('ul', { class: 'rows' });
  for (const a of acc.accounts || []) {
    const label = String(a.label ?? '');
    accList.append(
      el('li', {},
        el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, label.trim().charAt(0) || '·'), el('span', {}, label), statusPill(a.status))),
        el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => disconnect(a) }, T('disconnect'))
      )
    );
  }
  sections.push(
    card(T('accountsTitle'),
      acc.error ? errorBox(acc.error) : (acc.accounts || []).length ? accList : el('p', { class: 'note' }, T('noAccounts')),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn', type: 'button', onclick: () => startLink() }, icon('qr'), T('linkQr'))),
      el('p', { class: 'note' }, T('testAccountNote'))
    )
  );

  // Grants
  const gl = el('ul', { class: 'rows' });
  for (const g of grants.grants || []) {
    gl.append(
      el('li', {},
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, el('span', { class: 'avatar', 'aria-hidden': 'true' }, icon('spark')), el('span', {}, String(g.clientName ?? ''))),
          el('div', { class: 'tags' }, ...(g.scopes || []).map((x) => el('span', { class: 'tag' }, SCOPE_TITLES[x] || x)), el('span', { class: 'tag' }, T('grantAccounts', { count: (g.accounts || []).length })))
        ),
        el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => revoke(g) }, T('revoke'))
      )
    );
  }
  sections.push(
    card(T('clientsTitle'),
      grants.error ? errorBox(grants.error) : (grants.grants || []).length ? gl : el('p', { class: 'note' }, T('noGrants'))
    )
  );

  // Profile
  const profile = card(T('profileTitle'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn secondary btn-sm', type: 'button', onclick: logout }, T('logout')),
        el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: deleteProfile }, T('deleteProfile'))
      )
  );
  profile.classList.add('span-2');
  sections.push(profile);
  show(sections[0], el('div', { class: 'dash' }, ...sections.slice(1)));
}

async function startLink() {
  try {
    const r = await api('/api/accounts/link', { method: 'POST', body: {} });
    await pollLink(r.accountId, r.link);
  } catch (e) {
    show(panel(errorBox(e), el('button', { class: 'btn secondary', type: 'button', onclick: main }, T('back'))));
  }
}

async function pollLink(accountId, state) {
  let lastQr = '';
  for (;;) {
    if (state.state === 'active') {
      const actions = pendingContinue()
        ? el('div', { class: 'btn-row' }, continueButton(), el('button', { class: 'btn secondary', type: 'button', onclick: main }, T('toCabinet')))
        : el('button', { class: 'btn', type: 'button', onclick: main }, T('toCabinet'));
      show(panel(el('span', { class: 'usp-ico' }, icon('check')), el('h2', { class: 'card-title' }, T('linked')), pendingContinue() ? el('p', {}, T('connectReady')) : '', actions));
      return;
    }
    if (state.state === 'failed') {
      show(panel(el('p', { class: 'err', role: 'alert' }, LINK_ERRORS[state.code] || T('linkFailed')), el('button', { class: 'btn', type: 'button', onclick: main }, T('toCabinet'))));
      return;
    }
    if (state.state === 'need_password') {
      await askPassword(accountId, state.hint, state.invalidAttempts || 0);
      return;
    }
    if (state.state === 'waiting_scan' && state.qrUrl !== lastQr) {
      lastQr = state.qrUrl;
      show(
        el('section', { class: 'card qr-layout' },
          el('div', {}, el('h2', { class: 'card-title' }, T('scanTitle')), el('p', {}, T('scanHow')), el('p', { class: 'note' }, T('qrNote'))),
          qrNode(state.qrUrl)
        )
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
    state = await pollOnce(accountId);
  }
}

// A single failed poll (network blip, 5xx, upstream hiccup) must not abort a QR link that is still running
// server-side; give up only after several consecutive failures or on a definite answer.
const TRANSIENT = new Set([undefined, 'UPSTREAM_UNAVAILABLE', 'INTERNAL', 'RATE_LIMITED']);
async function pollOnce(accountId) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api(`/api/accounts/${accountId}/link-status`);
    } catch (e) {
      if (!TRANSIENT.has(e.code) || attempt >= 5) return { state: 'failed', code: e.code };
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function askPassword(accountId, hint, invalidAttempts = 0) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'password', id: 'tg-password', autocomplete: 'off' });
    const form = el('form', {
      onsubmit: async (ev) => {
        ev.preventDefault();
        const password = input.value;
        input.value = '';
        const st = await api(`/api/accounts/${accountId}/password`, { method: 'POST', body: { password } }).catch((e) => ({ state: 'failed', code: e.code }));
        resolve(pollLink(accountId, st));
      }
    }, el('div', { class: 'field' }, el('label', { for: 'tg-password' }, T('passwordAria')), input), el('div', { class: 'btn-row' }, el('button', { class: 'btn', type: 'submit' }, T('continue'))));
    show(
      panel(
        el('h2', { class: 'card-title' }, T('passwordTitle')),
        el('p', {}, T('passwordIntro')),
        invalidAttempts ? el('p', { class: 'err', role: 'alert' }, T('passwordWrong', { n: invalidAttempts })) : '',
        hint ? el('p', { class: 'note' }, T('hint', { hint })) : '',
        form
      )
    );
    input.focus();
  });
}

async function disconnect(a) {
  if (!confirm(T('confirmDisconnect', { label: a.label }))) return;
  await api(`/api/accounts/${a.accountId}/disconnect`, { method: 'POST', body: {} }).catch((e) => alert(e.message));
  main();
}

async function revoke(g) {
  if (!confirm(T('confirmRevoke', { client: g.clientName }))) return;
  await api(`/api/grants/${g.grantId}/revoke`, { method: 'POST', body: {} }).catch((e) => alert(e.message));
  main();
}

async function logout() {
  dropContinue();
  await api('/logout', { method: 'POST', body: {} }).catch(() => undefined);
  main();
}

async function deleteProfile() {
  const phrase = prompt(T('deletePrompt'));
  if (phrase === null) return;
  await api('/api/profile/delete', { method: 'POST', body: { confirm: phrase } })
    .then(() => main())
    .catch((e) => alert(e.reason === 'CONFIRM_PHRASE' ? T('deleteMismatch') : e.message));
}

main();
