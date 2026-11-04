import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { landing, cabinet } from '../src/pages.mjs';
import { connectAvailable, validateStatus } from '../src/render.mjs';

const status = validateStatus(JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8')));
const withAll = (s, v) => ({ ...status, registration_open: true, features: status.features.map((f) => ({ ...f, status: v })) });

describe('beta landing', () => {
  it('always shows the Beta badge and invitation', () => {
    const html = landing(status);
    expect(html).toContain('<span class="badge">Beta</span>');
    expect(html).toContain('Присоединиться к бета-тестированию');
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
    if (connectAvailable(status)) expect(landing(status)).toContain('href="https://app.postun.org/"');
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
});
