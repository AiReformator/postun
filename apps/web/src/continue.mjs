// Continuing an AI client's sign-in after linking a Telegram account in the cabinet.
//
// When /authorize finds no linked account, the auth Worker sends the user here with the pending request in the URL
// fragment: `#continue=<encoded /authorize path+query>`. The fragment never reaches a server or a Referer. The cabinet
// keeps the target only for this tab (sessionStorage, 30 minutes), strips it from the address bar at once, and offers
// a user-initiated "Continue" back to the auth origin, where GET /authorize re-validates every OAuth parameter.

export const CONTINUE_KEY = 'postun.continue';
export const CONTINUE_TTL_MS = 30 * 60 * 1000;

/** Mirror of the auth Worker's safeReturn (apps/auth/src/login.ts): only the authorize endpoint, printable ASCII. */
export function safeContinue(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || !raw.startsWith('/authorize') || raw.includes('\\') || raw.startsWith('//')) return null;
  if (raw !== '/authorize' && !raw.startsWith('/authorize?')) return null;
  return /^[\x21-\x7e]+$/.test(raw) ? raw : null;
}

/** Reads `#continue=<value>` (decoded exactly once). Any other fragment, or a bad value, gives null. */
export function continueFromHash(hash) {
  const prefix = '#continue=';
  if (typeof hash !== 'string' || !hash.startsWith(prefix)) return null;
  try {
    return safeContinue(decodeURIComponent(hash.slice(prefix.length)));
  } catch {
    return null;
  }
}

/** Per-tab store. Storage can be missing or throw (private mode, blocked site data): the cabinet then simply has no target. */
export function continueStore(storage, now = () => Date.now()) {
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    save(target) {
      const t = safeContinue(target);
      if (t) safe(() => storage.setItem(CONTINUE_KEY, JSON.stringify({ t, at: now() })));
    },
    load() {
      const raw = safe(() => storage.getItem(CONTINUE_KEY), null);
      if (!raw) return null;
      const v = safe(() => JSON.parse(raw), null);
      const t = v && safeContinue(v.t);
      if (!t || typeof v.at !== 'number' || now() - v.at > CONTINUE_TTL_MS || now() < v.at) {
        safe(() => storage.removeItem(CONTINUE_KEY));
        return null;
      }
      return t;
    },
    clear() {
      safe(() => storage.removeItem(CONTINUE_KEY));
    }
  };
}

/** Absolute URL to resume the sign-in: the auth origin from the page itself, never from the fragment. */
export function continueUrl(authOrigin, target) {
  const t = safeContinue(target);
  if (!t) return null;
  let origin;
  try {
    origin = new URL(authOrigin).origin;
  } catch {
    return null;
  }
  return origin + t;
}
