import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { landing, statusPage, cabinet, privacy, terms, faqItems, useCasesPage, useCaseFaq, USE_CASE_GROUPS, USE_CASE_COUNT, WEB_ANALYTICS_TOKEN, BEACON_SRC, CLIENTS } from '../src/pages.mjs';
import { robotsTxt, sitemapXml, llmsTxt } from '../src/seo.mjs';
import { connectAvailable, validateStatus } from '../src/render.mjs';
import { LOCALES, checkLocales, translator } from '../i18n/index.mjs';
import en from '../i18n/en.mjs';

const status = validateStatus(JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8')));
const withAll = (s, v) => ({ ...status, registration_open: true, features: status.features.map((f) => ({ ...f, status: v })) });

describe('beta landing', () => {
  it('always shows the Beta badge and invitation', () => {
    const html = landing(status);
    expect(html).toContain('<span class="badge">Beta</span>');
    expect(html).toContain(en.landing.cta);
    expect(landing(status, 'ru')).toContain('Присоединиться к бета-тестированию');
  });
  it('does not offer a working connect button until acceptance passed', () => {
    const pending = withAll(status, 'NOT_RUN');
    expect(connectAvailable(pending)).toBe(false);
    const html = landing(pending);
    expect(html).toMatch(/<button class="btn" disabled/);
    expect(html).not.toContain('href="https://app.postun.org/"');
  });
  it('the published status opens connect only through features backed by recorded evidence', () => {
    for (const f of status.features.filter((x) => x.status === 'PASS')) expect(f.evidence, f.id).toMatch(/\S/);
    if (connectAvailable(status)) for (const l of LOCALES) expect(landing(status, l.code)).toContain(`href="https://app.postun.org${l.prefix}/app/"`);
  });
  it('enables connect only when registration is open and key flows passed', () => {
    expect(connectAvailable(withAll(status, 'PASS'))).toBe(true);
    expect(connectAvailable({ ...withAll(status, 'PASS'), registration_open: false })).toBe(false);
    expect(connectAvailable(withAll(status, 'NOT_RUN'))).toBe(false);
  });
  it('rejects unknown statuses', () => {
    expect(() => validateStatus({ features: [{ id: 'x', status: 'SUPPORTED' }] })).toThrow();
  });
  it('escapes dynamic text', () => {
    const html = landing({ ...status, updated: '<script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
  });
  it('cabinet has no inline scripts (CSP script-src self)', () => {
    const html = cabinet(status);
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(html).toContain('src="/assets/app.js"');
  });

  it('every locale is complete: same keys and placeholders as the Russian source', () => {
    expect(checkLocales()).toEqual([]);
  });
  it('every status feature has a title in every locale', () => {
    for (const l of LOCALES) for (const f of status.features) expect(typeof l.dict.features[f.id], `${l.code}:${f.id}`).toBe('string');
  });
  it('renders each locale with its lang, canonical, hreflang alternates and switcher', () => {
    for (const l of LOCALES) {
      const html = landing(status, l.code);
      expect(html).toContain(`<html lang="${l.htmlLang}" data-locale="${l.code}">`);
      expect(html).toContain(`<link rel="canonical" href="https://postun.org${l.prefix}/">`);
      for (const o of LOCALES) expect(html).toContain(`hreflang="${o.htmlLang}" href="https://postun.org${o.prefix}/"`);
      expect(html).toContain('hreflang="x-default" href="https://postun.org/"');
      expect(html).toContain(`data-lang="${l.code}" href="${l.prefix}/" lang="${l.htmlLang}" hreflang="${l.htmlLang}" aria-current="true"`);
      expect(privacy(l.code)).toContain(translator(l.dict)('privacy.h1'));
      expect(terms(l.code)).toContain(translator(l.dict)('terms.h1'));
    }
  });
  it('English is the default and authoritative; translated legal pages say the English version prevails', () => {
    expect(landing(status)).toContain('<html lang="en"');
    expect(en.legal.translationNote).toBe('');
    for (const l of LOCALES.filter((x) => x.code !== 'en')) {
      expect(l.dict.legal.translationNote).not.toBe('');
      expect(terms(l.code)).toContain(l.dict.legal.translationNote);
      expect(privacy(l.code)).toContain(l.dict.legal.translationNote);
    }
  });
  it('translator escapes variables but keeps trusted markup', () => {
    const t = translator({ a: '<code>{x}</code>' });
    expect(t('a', { x: '<b>' })).toBe('<code>&lt;b&gt;</code>');
    expect(() => t('missing')).toThrow();
  });
});

describe('SEO: semantic core', () => {
  const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/<\\\//g, '</')));
  const visibleQuestions = (html) => [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
  const primary = { en: /Telegram MCP/i, ru: /Telegram MCP/i, es: /Telegram MCP/i, pt: /Telegram MCP/i, de: /Telegram-MCP/i };

  it('every locale has a keyword-bearing title and its own meta description', () => {
    for (const l of LOCALES) {
      const html = landing(status, l.code);
      const title = html.match(/<title>(.*)<\/title>/)[1];
      expect(title, l.code).toMatch(primary[l.code]);
      expect(title, l.code).toContain('ChatGPT');
      expect(title, l.code).toContain('Claude');
      const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
      expect(desc.length, l.code).toBeGreaterThan(100);
      expect(desc, l.code).not.toBe(l.dict.meta.description);
      expect(html).toContain('<h1>Connected, not collected.</h1>');
      expect(html).toContain(`<p class="tagline">${l.dict.landing.subtitle}</p>`);
    }
    expect(landing(status)).toContain('<title>Postun — Telegram MCP server for ChatGPT and Claude (open beta)</title>');
  });
  it('JSON-LD parses; FAQPage matches the visible FAQ; SoftwareApplication has the required fields', () => {
    for (const l of LOCALES) {
      const html = landing(status, l.code);
      const [faq, app] = ldBlocks(html);
      expect(faq['@type']).toBe('FAQPage');
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5);
      expect(faq.mainEntity.map((q) => q.name), l.code).toEqual(visibleQuestions(html));
      for (const q of faq.mainEntity) expect(q.acceptedAnswer.text).not.toMatch(/<|\{/);
      expect(app).toMatchObject({ '@type': 'SoftwareApplication', name: 'Postun', applicationCategory: 'DeveloperApplication', operatingSystem: 'Web' });
      expect(app.offers.price).toBe('0');
      expect(app.url).toBe(`https://postun.org${l.prefix}/`);
      expect(app.codeRepository).toBe('https://github.com/AiReformator/postun');
      expect(app.sameAs).toContain('https://github.com/AiReformator/postun');
    }
  });
  it('JSON-LD cannot break out of its script block', () => {
    const html = landing({ ...status, quota_daily_success: 5 });
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) expect(m[1]).not.toContain('</');
  });
  it('FAQ states Claude Code is not verified unless status says PASS, and never claims unverified features', () => {
    const notRun = withAll(status, 'NOT_RUN');
    expect(faqItems(notRun, 'en')[2].text).toContain('in testing');
    expect(faqItems(withAll(status, 'PASS'), 'en')[2].text).toContain('verified on production');
    expect(faqItems(status, 'en')[6].text).toContain('10,000');
    expect(faqItems(status, 'en')[2].text).toContain('https://mcp.postun.org/mcp');
  });
  it('the Open by design section names Kerckhoffs and links the repo and SECURITY.md in every locale', () => {
    for (const l of LOCALES) {
      const html = landing(status, l.code);
      const sec = html.match(/<section id="open">([\s\S]*?)<\/section>/)[1];
      expect(sec, l.code).toMatch(/Kerckhoff|Керкгофф/);
      expect(sec).toContain('https://github.com/AiReformator/postun"');
      expect(sec).toContain('/blob/main/SECURITY.md');
    }
  });
  it('sitemap lists every locale page with hreflang alternates and x-default, but not the cabinet', () => {
    const xml = sitemapXml('2026-11-05');
    for (const l of LOCALES) for (const p of ['/', '/use-cases/', '/status/', '/privacy/', '/terms/']) {
      expect(xml).toContain(`<loc>https://postun.org${l.prefix}${p}</loc>`);
      expect(xml).toContain(`hreflang="${l.htmlLang}" href="https://postun.org${l.prefix}${p}"`);
    }
    expect(xml).toContain('hreflang="x-default" href="https://postun.org/"');
    expect(xml).not.toContain('/app/');
    expect((xml.match(/<url>/g) ?? []).length).toBe(LOCALES.length * 5);
  });
  it('robots.txt allows all and points to the sitemap; llms.txt follows llmstxt.org and links everything', () => {
    expect(robotsTxt()).toBe('User-agent: *\nAllow: /\n\nSitemap: https://postun.org/sitemap.xml\n');
    const llms = llmsTxt(status);
    expect(llms.startsWith('# Postun\n\n> ')).toBe(true);
    for (const l of LOCALES) expect(llms).toContain(`(https://postun.org${l.prefix}/)`);
    for (const u of ['https://mcp.postun.org/mcp', 'https://github.com/AiReformator/postun', '/blob/main/SECURITY.md', 'Kerckhoffs']) expect(llms).toContain(u);
    expect(llms).toContain('https://postun.org/use-cases/');
    expect(llms).toContain('verified too');
    expect(llmsTxt(withAll(status, 'NOT_RUN'))).toContain('Search, public channels, file downloads are not yet verified.');
  });
  it('the build writes robots.txt, sitemap.xml and llms.txt into dist', () => {
    execFileSync(process.execPath, ['build.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
    for (const f of ['robots.txt', 'sitemap.xml', 'llms.txt']) expect(existsSync(new URL(`../dist/${f}`, import.meta.url)), f).toBe(true);
    expect(readFileSync(new URL('../dist/robots.txt', import.meta.url), 'utf8')).toContain('Sitemap: https://postun.org/sitemap.xml');
  }, 60000);
});

describe('plainText', () => {
  it('strips nested tags and decodes entities in a single pass', async () => {
    const { plainText } = await import('../src/pages.mjs');
    expect(plainText('<b>a</b> &amp; b')).toBe('a & b');
    expect(plainText('x &amp;lt; y')).toBe('x &lt; y');
    expect(plainText('<scr<script>ipt>alert(1)')).toBe('alert(1)');
    expect(plainText('5 &lt; 6 &gt; 4')).toBe('5 < 6 > 4');
    expect(plainText('it&#39;s &quot;q&quot;')).toBe('it\'s "q"');
  });
});

describe('design system', () => {
  const pages = (s) => LOCALES.flatMap((l) => [landing(s, l.code), useCasesPage(s, l.code), statusPage(l.code), privacy(l.code), terms(l.code), cabinet(s, l.code)]);
  it('hero claims AI-client compatibility only from status.json', () => {
    const hero = (s) => landing(s).match(/<ul class="flow-clients">([\s\S]*?)<\/ul>/)[1];
    const notRun = hero(withAll(status, 'NOT_RUN'));
    expect(notRun).not.toContain('pill-ok');
    expect(notRun.match(/pill-warn/g)).toHaveLength(2);
    const pass = hero(withAll(status, 'PASS'));
    expect(pass.match(/pill-ok/g)).toHaveLength(2);
    // Claude (claude.ai) has no status entry of its own, so the hero never shows it as verified.
    expect(pass).not.toMatch(/<li>Claude <span/);
    const live = hero(status);
    const st = Object.fromEntries(status.features.map((f) => [f.id, f.status]));
    expect(live).toMatch(new RegExp(`ChatGPT <span class="pill ${st.mcp_chatgpt === 'PASS' ? 'pill-ok' : 'pill-warn'}"`));
    expect(live).toMatch(new RegExp(`Claude Code <span class="pill ${st.mcp_claude_code === 'PASS' ? 'pill-ok' : 'pill-warn'}"`));
  });
  it('hero shows the MCP address before the call to action, in every locale and registration state', () => {
    for (const s of [withAll(status, 'PASS'), { ...status, registration_open: false }]) {
      for (const l of LOCALES) {
        const hero = landing(s, l.code).match(/<section class="hero">([\s\S]*?)<\/section>/)[1];
        const at = hero.indexOf('<code aria-labelledby="mcp-label">https://mcp.postun.org/mcp</code>');
        expect(at, l.code).toBeGreaterThan(-1);
        expect(at, l.code).toBeLessThan(hero.indexOf('class="btn-row"'));
        // The copy button ships hidden and is revealed by host.js only where the Clipboard API exists.
        expect(hero).toMatch(/<button type="button" class="btn btn-sm endpoint-copy" data-copy="https:\/\/mcp\.postun\.org\/mcp" data-copied="[^"]+" hidden>/);
      }
    }
  });
  it('connect section groups clients by status.json and never claims an untested client', () => {
    const section = (st) => landing(st).match(/<section id="connect"[\s\S]*?<\/section>/)[0];
    const groups = (st) => section(st).split('<div class="connect-group">').slice(1);
    const names = (g) => [...g.matchAll(/<span class="client-name">([^<]+)<\/span>/g)].map((m) => m[1]);
    const [okAll, restAll] = groups(withAll(status, 'PASS'));
    expect(names(okAll)).toEqual(['ChatGPT', 'Claude Code']);
    expect(names(restAll)).toContain('Claude');
    const [okNone, restNone] = groups(withAll(status, 'NOT_RUN'));
    expect(names(okNone)).toEqual([]);
    expect(names(restNone)).toEqual(CLIENTS.map((c) => c.name));
    for (const c of CLIENTS) expect(c.docs).toMatch(/^https:\/\//);
    for (const l of LOCALES) {
      const html = landing(status, l.code);
      expect(html).toContain('id="connect"');
      expect(html).toContain('id="security"');
      expect(html).toContain('claude mcp add --transport http postun https://mcp.postun.org/mcp');
    }
  });
  it('footer carries the trademark note and the Telegram support link on every page', () => {
    for (const l of LOCALES) {
      for (const html of [landing(status, l.code), useCasesPage(status, l.code), privacy(l.code), terms(l.code), cabinet(status, l.code)]) {
        const footer = html.match(/<footer[\s\S]*<\/footer>/)[0];
        expect(footer).toContain('href="https://t.me/postun_org"');
        expect(footer).toContain('class="foot-note foot-tm"');
      }
    }
  });
  it('links to the legal documents appear only in the footer', () => {
    for (const l of LOCALES) {
      const html = landing(status, l.code);
      const outside = html.replace(/<footer[\s\S]*<\/footer>/, '');
      expect(outside, l.code).not.toMatch(/href="[^"]*\/(privacy|terms)\/"/);
      const footer = html.match(/<footer[\s\S]*<\/footer>/)[0];
      expect(footer).toContain(`href="${l.prefix}/privacy/"`);
      expect(footer).toContain(`href="${l.prefix}/terms/"`);
    }
  });
  it('pages carry no inline styles or inline event handlers (CSP style-src/script-src self)', () => {
    for (const html of pages(status)) {
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/<style[\s>]/);
      expect(html).not.toMatch(/\son[a-z]+=/);
    }
  });
  it('the header offers the dashboard only when connecting is available', () => {
    expect(landing(withAll(status, 'NOT_RUN'))).not.toContain('header-cta');
    expect(landing(withAll(status, 'PASS'))).toContain('class="btn header-cta" href="https://app.postun.org/app/"');
  });
});

describe('web analytics', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  /** Content-Security-Policy values declared directly under the given path rule. */
  const csp = (rule) => {
    const out = [];
    let current = null;
    for (const line of headers.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      if (!/^\s/.test(line)) current = line.trim();
      else if (current === rule && line.trim().startsWith('Content-Security-Policy:')) out.push(line.trim().slice('Content-Security-Policy:'.length).trim());
    }
    return out;
  };

  it('public pages load the cookieless beacon with the public site token, in every locale', () => {
    expect(WEB_ANALYTICS_TOKEN).toMatch(/^[0-9a-f]{32}$/);
    for (const l of LOCALES) {
      for (const html of [landing(status, l.code), privacy(l.code), terms(l.code)]) {
        expect(html).toContain(`<script type="module" src="${BEACON_SRC}" data-cf-beacon='{"token":"${WEB_ANALYTICS_TOKEN}","spa":false}'></script>`);
      }
    }
  });

  it('the cabinet never loads the beacon', () => {
    for (const l of LOCALES) expect(cabinet(status, l.code)).not.toContain('cloudflareinsights');
  });

  it('the privacy page discloses the counter in every locale', () => {
    for (const l of LOCALES) expect(privacy(l.code)).toContain(l.dict.privacy.p4);
  });

  it('the site CSP allows only the beacon script and its endpoint; the cabinet adds a strict policy without them', () => {
    const [site] = csp('/*');
    expect(site).toContain(`script-src 'self' ${BEACON_SRC};`);
    expect(site).toContain('connect-src https://auth.postun.org https://status.postun.org https://cloudflareinsights.com;');
    expect(site).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    for (const block of ['/app/*', '/:lang/app/*']) {
      const policies = csp(block);
      expect(policies, block).toHaveLength(1);
      expect(policies[0]).toContain("script-src 'self';");
      expect(policies[0]).not.toContain('cloudflareinsights');
      expect(policies[0]).toContain('connect-src https://auth.postun.org;');
    }
  });
});

describe('use cases page', () => {
  const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1].replace(/<\\\//g, '</')));
  const scopes = readFileSync(new URL('../../../packages/contracts/src/scopes.ts', import.meta.url), 'utf8');
  const toolNames = [...scopes.match(/export const TOOLS = \[([\s\S]*?)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it('has 16 use cases in six groups, each with real Postun tools', () => {
    expect(USE_CASE_COUNT).toBe(16);
    expect(USE_CASE_GROUPS).toHaveLength(6);
    expect(toolNames.length).toBeGreaterThanOrEqual(8);
    for (const g of USE_CASE_GROUPS) for (const it of g.items) for (const tool of it.tools) expect(toolNames, tool).toContain(tool);
    expect(USE_CASE_GROUPS.flatMap((g) => g.items.map((i) => i.n))).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it('renders every locale with its own title, description, canonical and hreflang alternates', () => {
    const titles = new Set();
    for (const l of LOCALES) {
      const html = useCasesPage(status, l.code);
      expect(html).toContain(`<html lang="${l.htmlLang}"`);
      const title = html.match(/<title>(.*)<\/title>/)[1];
      expect([...title].length, l.code).toBeLessThanOrEqual(62);
      expect(title, l.code).toContain('Telegram');
      expect(title, l.code).toContain('ChatGPT');
      expect(title, l.code).toContain('16');
      titles.add(title);
      const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
      expect([...desc].length, l.code).toBeGreaterThan(100);
      expect([...desc].length, l.code).toBeLessThanOrEqual(160);
      expect(html).toContain(`<link rel="canonical" href="https://postun.org${l.prefix}/use-cases/">`);
      for (const o of LOCALES) expect(html).toContain(`<link rel="alternate" hreflang="${o.htmlLang}" href="https://postun.org${o.prefix}/use-cases/">`);
      expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://postun.org/use-cases/">');
      expect(html.match(/<h1>/g)).toHaveLength(1);
      expect(html.match(/class="uc-card ticked"/g)).toHaveLength(16);
      for (let n = 1; n <= 16; n++) expect(html).toContain(`id="use-case-${n}"`);
      expect(html).toContain(`<a href="${l.prefix}/use-cases/" aria-current="page">`);
    }
    expect(titles.size).toBe(LOCALES.length);
  });

  it('JSON-LD: breadcrumbs, the list of use cases and the FAQ that is visible on the page', () => {
    for (const l of LOCALES) {
      const html = useCasesPage(status, l.code);
      const [crumbs, page, faq] = ld(html);
      expect(crumbs['@type']).toBe('BreadcrumbList');
      expect(crumbs.itemListElement[1].item).toBe(`https://postun.org${l.prefix}/use-cases/`);
      expect(page['@type']).toBe('CollectionPage');
      expect(page.inLanguage).toBe(l.htmlLang);
      expect(page.mainEntity.numberOfItems).toBe(16);
      expect(page.mainEntity.itemListElement[0].url).toBe(`https://postun.org${l.prefix}/use-cases/#use-case-1`);
      for (const it of page.mainEntity.itemListElement) expect(it.name + it.description).not.toMatch(/[<>{}]/);
      expect(faq['@type']).toBe('FAQPage');
      const visible = [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
      expect(faq.mainEntity.map((q) => q.name)).toEqual(visible);
      expect(useCaseFaq(l.code)).toHaveLength(4);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) expect(m[1]).not.toContain('</');
    }
  });

  it('fills placeholders, links the connect guide and the quota, and never leaves {braces}', () => {
    for (const l of LOCALES) {
      const html = useCasesPage(status, l.code);
      expect(html, l.code).not.toMatch(/\{(home|quota|privacy)\}/);
      expect(html).toContain(`href="${l.prefix}/#connect"`);
      expect(html).toContain(`href="${l.prefix}/privacy/"`);
      expect(html).toContain(Number(10000).toLocaleString(l.htmlLang));
    }
  });

  it('offers the dashboard only when connecting is open, otherwise the connect guide', () => {
    expect(useCasesPage(withAll(status, 'PASS'))).toContain('href="https://app.postun.org/app/"');
    const closed = useCasesPage(withAll(status, 'NOT_RUN'));
    expect(closed).not.toContain('header-cta');
    expect(closed.match(/<div class="final ticked">[\s\S]*?<\/div>/)[0]).toContain('href="/#connect"');
  });

  it('every page links to the use cases from the header and footer; the landing has a teaser to each group', () => {
    for (const l of LOCALES) {
      for (const html of [landing(status, l.code), statusPage(l.code), privacy(l.code), terms(l.code)]) {
        const header = html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
        expect(header).toContain(`href="${l.prefix}/use-cases/"`);
        expect(html.match(/<footer[\s\S]*<\/footer>/)[0]).toContain(`href="${l.prefix}/use-cases/"`);
      }
      const teaser = landing(status, l.code).match(/<section id="use" class="section">([\s\S]*?)<\/section>/)[1];
      for (const g of USE_CASE_GROUPS) expect(teaser).toContain(`href="${l.prefix}/use-cases/#${g.id}"`);
    }
  });

  it('every page carries Open Graph tags that match its canonical URL and locale', () => {
    const og = { en: 'en_US', ru: 'ru_RU', es: 'es_ES', pt: 'pt_BR', de: 'de_DE' };
    for (const l of LOCALES) {
      for (const html of [landing(status, l.code), useCasesPage(status, l.code), statusPage(l.code)]) {
        const canonical = html.match(/<link rel="canonical" href="([^"]*)">/)[1];
        expect(html).toContain(`<meta property="og:url" content="${canonical}">`);
        expect(html).toContain(`<meta property="og:locale" content="${og[l.code]}">`);
        expect(html.match(/og:locale:alternate/g)).toHaveLength(LOCALES.length - 1);
        expect(html).toContain('<meta property="og:image" content="https://postun.org/assets/postun-icon-256.png">');
        expect(html.match(/<meta property="og:title" content="([^"]*)">/)[1]).toBe(html.match(/<title>(.*)<\/title>/)[1]);
      }
    }
  });

  it('the build writes the page for every locale', () => {
    execFileSync(process.execPath, ['build.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' });
    for (const l of LOCALES) expect(existsSync(new URL(`../dist${l.prefix}/use-cases/index.html`, import.meta.url)), l.code).toBe(true);
  }, 60000);
});
