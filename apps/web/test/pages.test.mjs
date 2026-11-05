import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { landing, cabinet, privacy, terms } from '../src/pages.mjs';
import { connectAvailable, validateStatus } from '../src/render.mjs';
import { LOCALES, checkLocales, translator } from '../i18n/index.mjs';
import ru from '../i18n/ru.mjs';
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
  it('English is the default and non-Russian legal pages say the Russian version prevails', () => {
    expect(landing(status)).toContain('<html lang="en"');
    expect(ru.legal.translationNote).toBe('');
    for (const l of LOCALES.filter((x) => x.code !== 'ru')) expect(terms(l.code)).toContain(l.dict.legal.translationNote);
  });
  it('translator escapes variables but keeps trusted markup', () => {
    const t = translator({ a: '<code>{x}</code>' });
    expect(t('a', { x: '<b>' })).toBe('<code>&lt;b&gt;</code>');
    expect(() => t('missing')).toThrow();
  });
});
