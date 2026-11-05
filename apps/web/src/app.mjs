// Postun Beta cabinet. Talks only to the auth origin with credentialed fetch; holds no tokens in storage.
// All server text is inserted with textContent (no innerHTML with dynamic data).
import { encodeQR } from 'qr';
import en from '../i18n/en.mjs';
import ru from '../i18n/ru.mjs';
import es from '../i18n/es.mjs';
import pt from '../i18n/pt.mjs';
import de from '../i18n/de.mjs';

const root = document.getElementById('app');
const AUTH = root.dataset.auth;
const LOCALE = document.documentElement.dataset.locale || 'en';
const S = ({ en, ru, es, pt, de }[LOCALE] || en).app;
/** Cabinet text is inserted with textContent, so {vars} are substituted without HTML escaping. */
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

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = csrf;
  }
  const res = await fetch(AUTH + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Server messages are Russian; other locales show a localized message for known codes.
    const code = data.error && data.error.code;
    const msg = LOCALE === 'ru' && data.error && data.error.message ? data.error.message : LINK_ERRORS[code] || T('requestError');
    const err = new Error(msg);
    err.code = data.error && data.error.code;
    err.reason = data.error && data.error.reason;
    throw err;
  }
  return data;
}

function show(...nodes) {
  root.replaceChildren(...nodes);
}

function errorBox(e) {
  return el('p', { class: 'err' }, e.message || T('error'));
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
    const intro = el('p', {}, T('loginIntro'));
    const btn = s.registrationOpen
      ? el('a', { class: 'btn', href: s.loginUrl }, T('login'))
      : el('button', { class: 'btn', disabled: '' }, T('login'));
    const note = s.registrationOpen ? '' : el('p', { class: 'note' }, T('registrationClosed'));
    show(intro, btn, note);
    return;
  }
  csrf = s.csrfToken;
  if (s.termsRequired) {
    show(
      el('p', {}, T('termsIntro')),
      el('a', { class: 'btn', href: s.termsUrl }, T('termsOpen'))
    );
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
  sections.push(el('p', { class: 'note' }, T('betaNote')));

  // Quota
  const u = usage.usage;
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, T('quotaTitle')),
      u ? el('p', {}, T('quota', { day: u.day, used: u.daySuccessCount, limit: u.dailySuccessLimit ?? u.monthlySuccessLimit, monthUsed: u.successCount, bytes: u.outBytes })) : errorBox(usage.error)
    )
  );

  // Accounts
  const accList = el('ul', { class: 'plain' });
  for (const a of acc.accounts || []) {
    accList.append(
      el('li', {},
        `${a.label} — ${a.status === 'active' ? T('accActive') : a.status === 'pending' ? T('accPending') : a.status} `,
        el('button', { class: 'btn secondary', onclick: () => disconnect(a) }, T('disconnect'))
      )
    );
  }
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, T('accountsTitle')),
      acc.error ? errorBox(acc.error) : (acc.accounts || []).length ? accList : el('p', { class: 'note' }, T('noAccounts')),
      el('button', { class: 'btn', onclick: () => startLink() }, T('linkQr')),
      el('p', { class: 'note' }, T('testAccountNote'))
    )
  );

  // Grants
  const gl = el('ul', { class: 'plain' });
  for (const g of grants.grants || []) {
    const scopes = (g.scopes || []).map((x) => SCOPE_TITLES[x] || x).join(', ');
    gl.append(
      el('li', {},
        `${T('grantLine', { client: g.clientName, scopes, count: (g.accounts || []).length })} `,
        el('button', { class: 'btn secondary', onclick: () => revoke(g) }, T('revoke'))
      )
    );
  }
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, T('clientsTitle')),
      grants.error ? errorBox(grants.error) : (grants.grants || []).length ? gl : el('p', { class: 'note' }, T('noGrants')),
      el('p', { class: 'note' }, T('mcpNote'))
    )
  );

  // Profile
  sections.push(
    el('section', { class: 'card' },
      el('h2', {}, T('profileTitle')),
      el('button', { class: 'btn secondary', onclick: logout }, T('logout')),
      ' ',
      el('button', { class: 'btn secondary', onclick: deleteProfile }, T('deleteProfile'))
    )
  );
  show(...sections);
}

async function startLink() {
  try {
    const r = await api('/api/accounts/link', { method: 'POST', body: {} });
    await pollLink(r.accountId, r.link);
  } catch (e) {
    show(errorBox(e), el('button', { class: 'btn', onclick: main }, T('back')));
  }
}

async function pollLink(accountId, state) {
  let lastQr = '';
  for (;;) {
    if (state.state === 'active') {
      show(el('p', {}, T('linked')), el('button', { class: 'btn', onclick: main }, T('toCabinet')));
      return;
    }
    if (state.state === 'failed') {
      show(el('p', { class: 'err' }, LINK_ERRORS[state.code] || T('linkFailed')), el('button', { class: 'btn', onclick: main }, T('toCabinet')));
      return;
    }
    if (state.state === 'need_password') {
      await askPassword(accountId, state.hint, state.invalidAttempts || 0);
      return;
    }
    if (state.state === 'waiting_scan' && state.qrUrl !== lastQr) {
      lastQr = state.qrUrl;
      show(
        el('h2', {}, T('scanTitle')),
        el('p', {}, T('scanHow')),
        qrNode(state.qrUrl),
        el('p', { class: 'note' }, T('qrNote'))
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
    const input = el('input', { type: 'password', autocomplete: 'off', 'aria-label': T('passwordAria') });
    const form = el('form', {
      onsubmit: async (ev) => {
        ev.preventDefault();
        const password = input.value;
        input.value = '';
        const st = await api(`/api/accounts/${accountId}/password`, { method: 'POST', body: { password } }).catch((e) => ({ state: 'failed', code: e.code }));
        resolve(pollLink(accountId, st));
      }
    }, input, ' ', el('button', { class: 'btn', type: 'submit' }, T('continue')));
    show(
      el('h2', {}, T('passwordTitle')),
      el('p', {}, T('passwordIntro')),
      invalidAttempts ? el('p', { class: 'err' }, T('passwordWrong', { n: invalidAttempts })) : '',
      hint ? el('p', { class: 'note' }, T('hint', { hint })) : '',
      form
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
