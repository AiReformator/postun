// Cabinet API client. Turns every failure into an Error whose message is already localized for the cabinet:
// the browser's own network errors ("Failed to fetch", "NetworkError when attempting to fetch resource") are
// English and engine-specific, so they never reach the page.

/**
 * @param {object} o
 * @param {string} o.base       auth origin
 * @param {string} o.locale     cabinet locale code
 * @param {(key: string) => string} o.t  cabinet translator
 * @param {Record<string, string>} o.linkErrors  localized messages for known error codes
 * @param {() => string} o.csrf current CSRF token
 * @param {typeof fetch} [o.fetchImpl]
 */
export function createApi({ base, locale, t, linkErrors, csrf, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  return async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      headers['x-csrf-token'] = csrf();
    }
    let res;
    try {
      res = await fetchImpl(base + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
    } catch {
      // No HTTP answer at all (offline, DNS, blocked, CORS). No code: callers that retry treat it as transient.
      const err = new Error(t('networkError'));
      err.network = true;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Server messages are Russian; other locales show a localized message for known codes.
      const code = data.error && data.error.code;
      const msg = locale === 'ru' && data.error && data.error.message ? data.error.message : linkErrors[code] || t('requestError');
      const err = new Error(msg);
      err.code = code;
      err.reason = data.error && data.error.reason;
      throw err;
    }
    return data;
  };
}
