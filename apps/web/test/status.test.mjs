import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { statusPage, landing } from '../src/pages.mjs';
import { sitemapXml, llmsTxt } from '../src/seo.mjs';
import { LOCALES, checkLocales, flatten } from '../i18n/index.mjs';
import ru from '../i18n/ru.mjs';
import { COMPONENT_IDS, LIMITS, STALE_MS, STATUS_ORIGIN, STATUS_URL, barDays, dayLevel, evaluate, parseStatusText, validateStatusData } from '../src/status-data.mjs';

const status = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-06T12:00:00Z');

const days = (n = 90) =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 10, 6) - (n - 1 - i) * 86400000).toISOString().slice(0, 10), uptime: i % 10 === 0 ? null : 100 }));
const comp = (id, extra = {}) => ({ id, status: 'operational', latency_ms: 120, uptime: { '24h': 100, '7d': 99.98, '90d': 99.9 }, days: days(), ...extra });
const sample = (extra = {}) => ({
  schema: 'postun-status/v1',
  generated_at: '2026-11-06T11:59:00Z',
  overall: 'operational',
  components: COMPONENT_IDS.map((id) => comp(id)),
  incidents: [
    { start: '2026-11-01T10:00:00Z', end: '2026-11-01T10:20:00Z', components: ['mcp'], status: 'resolved' },
    { start: '2026-11-05T10:00:00Z', end: null, components: ['telegram', 'auth'], status: 'ongoing' }
  ],
  ...extra
});

describe('status data validator', () => {
  it('accepts a valid sample, ignores unknown fields and sorts incidents newest first', () => {
    const raw = sample({ extra: 1 });
    raw.components[0].surprise = true;
    const r = validateStatusData(raw);
    expect(r.ok).toBe(true);
    expect(r.data.components).toHaveLength(5);
    expect(r.data.components[0]).not.toHaveProperty('surprise');
    expect(r.data).not.toHaveProperty('extra');
    expect(r.data.incidents[0].status).toBe('ongoing');
    expect(parseStatusText(JSON.stringify(raw)).ok).toBe(true);
  });
  it('drops components this page has no name for, accepts null latency and null days', () => {
    const raw = sample();
    raw.components.push(comp('newthing'));
    raw.components[1].latency_ms = null;
    const r = validateStatusData(raw);
    expect(r.ok).toBe(true);
    expect(r.data.components.map((c) => c.id)).toEqual(COMPONENT_IDS);
  });
  const bad = {
    'wrong schema': (r) => (r.schema = 'postun-status/v2'),
    'missing schema': (r) => delete r.schema,
    'bad overall': (r) => (r.overall = 'fine'),
    'bad generated_at': (r) => (r.generated_at = 'yesterday'),
    'date without zone': (r) => (r.generated_at = '2026-11-06T11:59:00'),
    'component status': (r) => (r.components[0].status = 'ok'),
    'negative latency': (r) => (r.components[0].latency_ms = -1),
    'string latency': (r) => (r.components[0].latency_ms = '12'),
    'uptime over 100': (r) => (r.components[0].uptime['24h'] = 100.5),
    'uptime NaN-like string': (r) => (r.components[0].uptime['7d'] = '99'),
    'missing uptime key': (r) => delete r.components[0].uptime['90d'],
    'bad day date': (r) => (r.components[0].days[3].date = '2026-02-30'),
    'bad day uptime': (r) => (r.components[0].days[3].uptime = 101),
    'duplicate day': (r) => (r.components[0].days[1].date = r.components[0].days[0].date),
    'duplicate component': (r) => r.components.push(comp('site')),
    'incident status': (r) => (r.incidents[0].status = 'closed'),
    'ongoing with end': (r) => (r.incidents[1].end = '2026-11-05T11:00:00Z'),
    'resolved without end': (r) => (r.incidents[0].end = null),
    'end before start': (r) => (r.incidents[0].end = '2026-10-01T00:00:00Z'),
    'incident components not ids': (r) => (r.incidents[0].components = ['<script>']),
    'components not array': (r) => (r.components = {}),
    'too many components': (r) => (r.components = Array.from({ length: LIMITS.components + 1 }, (_, i) => comp(`c${i}`))),
    'too many days': (r) => (r.components[0].days = days(LIMITS.days + 1)),
    'too many incidents': (r) => (r.incidents = Array.from({ length: LIMITS.incidents + 1 }, () => ({ ...r.incidents[0] }))),
    'overlong id': (r) => (r.components[0].id = 'x'.repeat(LIMITS.idLength + 1))
  };
  for (const [name, mutate] of Object.entries(bad)) {
    it(`rejects: ${name}`, () => {
      const raw = sample();
      mutate(raw);
      expect(validateStatusData(raw).ok).toBe(false);
    });
  }
  it('rejects non-objects, bad JSON and oversized text without throwing', () => {
    for (const v of [null, 1, 'x', [], undefined]) expect(validateStatusData(v).ok).toBe(false);
    expect(parseStatusText('{nope').ok).toBe(false);
    expect(parseStatusText('x'.repeat(LIMITS.bytes + 1)).ok).toBe(false);
    expect(parseStatusText(undefined).ok).toBe(false);
  });
});

describe('validator: nothing after the snapshot time', () => {
  it('rejects a future day bar and a future incident', () => {
    const raw = sample();
    raw.components[0].days.push({ date: '2026-11-20', uptime: 100 });
    expect(validateStatusData(raw)).toMatchObject({ ok: false, reason: 'future day' });
    const inc = sample({ incidents: [{ start: '2026-12-01T10:00:00Z', end: null, components: ['mcp'], status: 'ongoing' }] });
    expect(validateStatusData(inc)).toMatchObject({ ok: false, reason: 'future incident' });
  });
});

describe('freshness: stale or missing data is unknown, never outage', () => {
  const ok = (raw) => validateStatusData(raw);
  it('fresh outage data shows the outage', () => {
    const v = evaluate(ok(sample({ overall: 'outage' })), NOW);
    expect(v.state).toBe('outage');
    expect(v.data).not.toBeNull();
  });
  it('data older than 10 minutes is unknown, even if it said outage', () => {
    const raw = sample({ overall: 'outage', generated_at: new Date(NOW - STALE_MS - 1000).toISOString() });
    const v = evaluate(ok(raw), NOW);
    expect(v).toMatchObject({ state: 'unknown', data: null, reason: 'stale' });
    expect(evaluate(ok({ ...raw, generated_at: new Date(NOW - STALE_MS + 1000).toISOString() }), NOW).state).toBe('outage');
  });
  it('fetch failure, invalid data and far-future timestamps are unknown', () => {
    expect(evaluate({ ok: false, reason: 'fetch' }, NOW).state).toBe('unknown');
    expect(evaluate(null, NOW).state).toBe('unknown');
    expect(evaluate(ok(sample({ generated_at: '2027-01-01T00:00:00Z' })), NOW)).toMatchObject({ state: 'unknown', reason: 'future' });
  });
});

describe('90-day strip helpers', () => {
  it('maps uptime to levels', () => {
    expect([null, 100, 99.5, 99.4, 95, 94.9, 0].map(dayLevel)).toEqual(['none', 'ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
  });
  it('always returns exactly 90 bars ending with the newest day', () => {
    const short = barDays(days(10));
    expect(short).toHaveLength(90);
    expect(short[0].date).toBeNull();
    expect(short[89].date).toBe('2026-11-06');
    const long = barDays(days(200));
    expect(long).toHaveLength(90);
    expect(long[89].date).toBe('2026-11-06');
  });
});

describe('status page', () => {
  it('renders in every locale with lang, canonical, hreflang alternates and switcher', () => {
    for (const l of LOCALES) {
      const html = statusPage(l.code);
      expect(html).toContain(`<html lang="${l.htmlLang}" data-locale="${l.code}">`);
      expect(html).toContain(`<link rel="canonical" href="https://postun.org${l.prefix}/status/">`);
      for (const o of LOCALES) {
        expect(html).toContain(`hreflang="${o.htmlLang}" href="https://postun.org${o.prefix}/status/"`);
        expect(html).toContain(`data-lang="${o.code}" href="${o.prefix}/status/"`);
      }
      expect(html).toContain('hreflang="x-default" href="https://postun.org/status/"');
      expect(html).toContain(`data-lang="${l.code}" href="${l.prefix}/status/" lang="${l.htmlLang}" hreflang="${l.htmlLang}" aria-current="true"`);
      expect(html).toContain(`<h1>${l.dict.statusPage.h1}</h1>`);
      expect(html).toContain(`<title>${l.dict.statusPage.title}</title>`);
    }
  });
  it('server-renders the skeleton: every component name, the legend and the no-JS note', () => {
    for (const l of LOCALES) {
      const html = statusPage(l.code);
      for (const id of COMPONENT_IDS) {
        expect(html).toContain(`data-component="${id}"`);
        expect(html).toContain(`<h2>${l.dict.statusPage.comp[id]}</h2>`);
      }
      expect(html).toContain(`<noscript>${l.dict.statusPage.noscript}</noscript>`);
      expect(html).toContain(l.dict.statusPage.legend.outage);
      expect(html).toContain(`data-src="${STATUS_URL}"`);
    }
    expect(statusPage('en')).toContain('<h2>MCP server (AI clients)</h2>');
    expect(statusPage('en')).toContain('<h2>Telegram connection</h2>');
  });
  it('loads only the same-origin status script and has no inline scripts or styles', () => {
    const html = statusPage('en');
    expect(html).toContain('<script src="/assets/status.js" defer></script>');
    const execScripts = [...html.matchAll(/<script(?![^>]*type="application\/json")(?![^>]*type="module")[^>]*>/g)].map((m) => m[0]);
    for (const tag of execScripts) expect(tag).toMatch(/src="\/assets\/[a-z.]+js"/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
  });
  it('the i18n data block is valid JSON, cannot close its script tag, and carries the locale strings', () => {
    for (const l of LOCALES) {
      const m = statusPage(l.code).match(/<script type="application\/json" id="status-i18n">([\s\S]*?)<\/script>/);
      expect(m[1]).not.toContain('<');
      expect(JSON.parse(m[1])).toEqual(l.dict.statusPage);
    }
  });
  it('locale parity covers every new key', () => {
    expect(checkLocales()).toEqual([]);
    const keys = flatten(ru.statusPage).map(([k]) => k);
    expect(keys.length).toBeGreaterThan(40);
    for (const l of LOCALES) {
      const got = new Set(flatten(l.dict.statusPage).map(([k]) => k));
      for (const k of keys) expect(got.has(k), `${l.code}:${k}`).toBe(true);
      expect(typeof l.dict.footer.statusPage).toBe('string');
    }
  });
  it('the footer links the status page on every page and locale', () => {
    for (const l of LOCALES) {
      expect(landing(status, l.code)).toContain(`<a href="${l.prefix}/status/">${l.dict.footer.statusPage}</a>`);
      expect(statusPage(l.code)).toContain(`<a href="${l.prefix}/status/">${l.dict.footer.statusPage}</a>`);
    }
  });
  it('sitemap and llms.txt include the status pages', () => {
    const xml = sitemapXml('2026-11-06');
    for (const l of LOCALES) expect(xml).toContain(`<loc>https://postun.org${l.prefix}/status/</loc>`);
    expect(llmsTxt(status)).toContain('(https://postun.org/status/)');
  });
  it('German uses the formal Sie form', () => {
    expect(LOCALES.find((l) => l.code === 'de').dict.statusPage.noscript).toMatch(/Aktivieren Sie/);
  });
});

describe('CSP headers', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const policies = headers.split('\n').filter((l) => l.trim().startsWith('Content-Security-Policy:'));
  const directive = (p, name) => p.match(new RegExp(`${name} ([^;]*)`))?.[1] ?? '';
  it('the public policy allows the status origin in connect-src only', () => {
    const pub = policies[0];
    expect(directive(pub, 'connect-src')).toContain(STATUS_ORIGIN);
    expect(pub.replace(directive(pub, 'connect-src'), '')).not.toContain('status.postun.org');
    expect(directive(pub, 'script-src')).not.toContain('status.postun');
  });
  it('the cabinet policies stay strict', () => {
    expect(policies).toHaveLength(3);
    for (const p of policies.slice(1)) expect(p).not.toContain('status.postun.org');
  });
});

describe('status client source', () => {
  const src = readFileSync(new URL('../src/status.mjs', import.meta.url), 'utf8');
  it('never writes data into the DOM as markup', () => {
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  });
});

describe('overall banner never hides a failing component', () => {
  it('uses the worst of overall and component states', async () => {
    const { validateStatusData, evaluate } = await import('../src/status-data.mjs');
    const now = Date.parse('2026-11-06T00:30:00Z');
    const comp = (id, status) => ({ id, status, latency_ms: 100, uptime: { '24h': 100, '7d': 100, '90d': 100 }, days: [] });
    const raw = { schema: 'postun-status/v1', generated_at: '2026-11-06T00:29:00Z', overall: 'operational', components: [comp('site', 'operational'), comp('mcp', 'outage')], incidents: [] };
    const r = validateStatusData(raw);
    expect(r.ok).toBe(true);
    expect(evaluate(r, now).state).toBe('outage');
    const r2 = validateStatusData({ ...raw, components: [comp('site', 'operational'), comp('mcp', 'unknown')] });
    expect(evaluate(r2, now).state).toBe('operational');
  });
});
