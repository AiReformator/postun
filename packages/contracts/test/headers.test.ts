import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, withSecurityHeaders } from '../src/config';

describe('security headers', () => {
  it('keeps the Origin header on same-origin form POSTs (CSRF check) without leaking referrers cross-origin', () => {
    // 'no-referrer' makes browsers send `Origin: null` on same-origin POSTs and broke the terms/consent forms.
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('same-origin');
    const r = withSecurityHeaders(new Response('x'));
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});
