// Client of the public status page. Fetches the monitoring JSON (postun-status/v1) from the status origin, validates it
// strictly (src/status-data.mjs) and renders it. All data reaches the DOM through textContent / setAttribute only:
// no markup APIs are used anywhere in this file. Missing, malformed or stale data shows "monitoring data unavailable".
import { LIMITS, PILL_CLASS, barDays, dayLevel, evaluate, parseStatusText } from './status-data.mjs';

const FETCH_TIMEOUT_MS = 8000;
const REFRESH_MS = 60 * 1000;
const TICK_MS = 30 * 1000;

const root = document.getElementById('status-root');
const i18nNode = document.getElementById('status-i18n');

function readStrings() {
  try {
    const v = JSON.parse(i18nNode.textContent);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const S = root && i18nNode ? readStrings() : null;
if (S) start();

function start() {
  const lang = document.documentElement.lang || 'en';
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
  const safe = (make, fallback) => {
    try {
      return make();
    } catch {
      return fallback;
    }
  };
  const dateFmt = safe(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }), null);
  const dateTimeFmt = safe(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' }), null);
  const pctFmt = safe(() => new Intl.NumberFormat(lang, { maximumFractionDigits: 2, minimumFractionDigits: 0 }), null);
  const numFmt = safe(() => new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }), null);
  const relFmt = safe(() => new Intl.RelativeTimeFormat(lang, { numeric: 'always', style: 'short' }), null);

  const fmtPct = (n) => `${pctFmt ? pctFmt.format(n) : n}%`;
  const fmtDay = (iso) => {
    return dateFmt ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : iso;
  };
  const fmtTime = (ms) => (dateTimeFmt ? dateTimeFmt.format(new Date(ms)) : new Date(ms).toISOString());
  const fmtAgo = (ageMs) => {
    const minutes = Math.floor(ageMs / 60000);
    if (minutes < 1) return S.justNow;
    return relFmt ? relFmt.format(-minutes, 'minute') : `${minutes} min`;
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const banner = document.getElementById('status-banner');
  const titleNode = document.getElementById('status-title');
  const textNode = document.getElementById('status-text');
  const list = document.getElementById('status-components');
  const incSection = document.getElementById('status-incidents-section');
  const incList = document.getElementById('status-incidents');

  let last = null; // last parse result { ok, data } or { ok: false }
  let lastFetchAt = 0;
  let inFlight = false;

  function setBanner(state, title, text) {
    banner.className = `status-banner is-${state}`;
    titleNode.textContent = title;
    textNode.textContent = text;
  }

  function setPill(node, state) {
    node.className = `pill ${PILL_CLASS[state]}`;
    node.textContent = S.state[state];
  }

  function metric(label, value) {
    const wrap = el('div', 'status-metric');
    wrap.append(el('dt', null, label), el('dd', null, value));
    return wrap;
  }

  function strip(c, startActive = -1) {
    const box = el('div', 'status-history');
    const bars = el('div', 'status-strip');
    bars.tabIndex = 0;
    bars.setAttribute('role', 'group');
    bars.setAttribute('aria-label', `${S.history}. ${S.historyHelp}`);
    const tip = el('p', 'status-tip note');
    tip.setAttribute('aria-live', 'polite');
    const labels = [];
    const nodes = barDays(c.days, LIMITS.barDays).map((d, i) => {
      const label = d.date === null ? null : d.uptime === null ? fill(S.dayNoData, { date: fmtDay(d.date) }) : fill(S.dayUptime, { date: fmtDay(d.date), uptime: fmtPct(d.uptime) });
      labels[i] = label;
      const bar = el('span', `status-day day-${dayLevel(d.uptime)}`);
      if (label) {
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', label);
        bar.title = label;
      } else {
        bar.setAttribute('aria-hidden', 'true');
      }
      return bar;
    });
    bars.append(...nodes);
    let active = -1;
    const show = (i) => {
      if (active >= 0) nodes[active].classList.remove('is-active');
      active = i;
      if (i >= 0) nodes[i].classList.add('is-active');
      tip.textContent = i >= 0 && labels[i] ? labels[i] : '';
    };
    nodes.forEach((n, i) => n.addEventListener('mouseenter', () => show(i)));
    bars.addEventListener('mouseleave', () => show(-1));
    // Bars are ~1-3 px wide on phones: resolve the day from the pointer position so touch and pen work too.
    const pick = (e) => {
      const r = bars.getBoundingClientRect();
      if (!r.width) return;
      show(Math.min(nodes.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * nodes.length))));
    };
    bars.addEventListener('pointerdown', pick);
    bars.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' ? e.buttons : true) pick(e);
    });
    bars.addEventListener('focus', () => {
      if (active < 0) show(nodes.length - 1);
    });
    bars.addEventListener('blur', () => show(-1));
    bars.addEventListener('keydown', (e) => {
      const keys = { ArrowLeft: -1, ArrowRight: 1 };
      let next;
      if (e.key in keys) next = Math.min(nodes.length - 1, Math.max(0, (active < 0 ? nodes.length - 1 : active) + keys[e.key]));
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = nodes.length - 1;
      else return;
      e.preventDefault();
      show(next);
    });
    if (startActive >= 0 && startActive < nodes.length) show(startActive);
    const axis = el('div', 'status-axis note');
    axis.append(el('span', null, S.historyFrom), el('span', null, S.historyTo));
    box.append(bars, axis, tip);
    return box;
  }

  function renderComponent(li, c, focus) {
    setPill(li.querySelector('[data-role="pill"]'), c ? c.status : 'unknown');
    const body = li.querySelector('[data-role="body"]');
    body.replaceChildren();
    if (!c) {
      body.hidden = true;
      return;
    }
    const dl = el('dl', 'status-metrics');
    dl.append(
      metric(S.latency, c.latency_ms === null ? '—' : fill(S.ms, { ms: numFmt ? numFmt.format(c.latency_ms) : Math.round(c.latency_ms) })),
      metric(S.up24h, fmtPct(c.uptime['24h'])),
      metric(S.up7d, fmtPct(c.uptime['7d'])),
      metric(S.up90d, fmtPct(c.uptime['90d']))
    );
    body.append(dl, strip(c, focus ? focus.index : -1));
    body.hidden = false;
    if (focus) body.querySelector('.status-strip').focus({ preventScroll: true });
  }

  function renderIncidents(data) {
    incList.replaceChildren();
    if (!data) {
      incSection.hidden = true;
      return;
    }
    incSection.hidden = false;
    const names = (id) => (S.comp && typeof S.comp[id] === 'string' ? S.comp[id] : null);
    const items = data.incidents.slice(0, LIMITS.shownIncidents);
    if (!items.length) {
      incList.append(el('li', 'status-incident note', S.incidentsNone));
      return;
    }
    for (const inc of items) {
      const li = el('li', `status-incident is-${inc.status}`);
      const head = el('div', 'status-incident-head');
      head.append(el('span', `pill ${inc.status === 'ongoing' ? 'pill-warn' : 'pill-ok'}`, inc.status === 'ongoing' ? S.incOngoing : S.incResolved));
      const when = inc.endMs === null ? fill(S.incSince, { start: fmtTime(inc.startMs) }) : fill(S.incRange, { start: fmtTime(inc.startMs), end: fmtTime(inc.endMs) });
      head.append(el('time', 'status-incident-time', when));
      li.append(head);
      const affected = inc.components.map(names).filter(Boolean);
      if (affected.length) li.append(el('p', 'note', fill(S.incAffected, { list: affected.join(', ') })));
      incList.append(li);
    }
  }

  function render(now = Date.now()) {
    const view = evaluate(last, now);
    const byId = new Map((view.data ? view.data.components : []).map((c) => [c.id, c]));
    // The refresh rebuilds the strips; keep a keyboard user on the strip (and on the selected day) instead of dropping focus.
    const ae = document.activeElement;
    const focused = ae && ae.classList && ae.classList.contains('status-strip') ? ae.closest('[data-component]') : null;
    const focusIndex = focused ? [...ae.children].findIndex((n) => n.classList.contains('is-active')) : -1;
    for (const li of list.querySelectorAll('[data-component]')) {
      renderComponent(li, byId.get(li.dataset.component) ?? null, li === focused ? { index: focusIndex } : null);
    }
    renderIncidents(view.data);
    if (!view.data) {
      setBanner('unknown', S.overall.unknown, S.unavailable);
      return;
    }
    setBanner(view.state, S.overall[view.state], fill(S.updated, { when: fmtAgo(view.ageMs) }));
  }

  // Reads the body with a hard byte cap, so an oversized or endless response is never buffered whole.
  async function readCapped(res) {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > LIMITS.bytes) throw new Error('size');
    if (!res.body) {
      const text = await res.text();
      if (text.length > LIMITS.bytes) throw new Error('size');
      return text;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let got = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (got > LIMITS.bytes) {
        reader.cancel().catch(() => {});
        throw new Error('size');
      }
      text += dec.decode(value, { stream: true });
    }
    return text + dec.decode();
  }

  async function load() {
    if (inFlight) return;
    inFlight = true;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(root.dataset.src, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', mode: 'cors', redirect: 'error', headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('http');
      last = parseStatusText(await readCapped(res));
    } catch {
      last = { ok: false, reason: 'fetch' };
    } finally {
      clearTimeout(timer);
      inFlight = false;
      lastFetchAt = Date.now();
    }
    render();
  }

  setBanner('unknown', S.loading, '');
  load();
  setInterval(() => {
    if (document.visibilityState === 'visible') load();
  }, REFRESH_MS);
  setInterval(() => {
    if (document.visibilityState === 'visible' && last) render();
  }, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetchAt >= REFRESH_MS) load();
  });
}
