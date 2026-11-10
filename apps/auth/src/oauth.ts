import { AuthorizationError, CimdFetchError, OAuthAuthorizationServer } from '@cloudflare/workers-oauth-provider';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { GrantPropsSchema, hmac, hmacVerify, fromBase64Url, normalizeScopes, oauthStepPoint, PostunError, SCOPES, sha256, toBase64Url, utf8, UuidSchema, withSecurityHeaders, writeMetric } from '@postun/contracts';
import type { Scope } from '@postun/contracts';
import { activeGrantIdsForClient, createGrant, ownedActiveAccounts, revokeGrant } from './grants';
import type { Config, Env } from './env';
import { csp, errorPage, esc, html, page, redirect } from './http';
import { listAccounts, MAX_ACCOUNTS } from './accounts';
import { scopeLabel, t } from './i18n';
import type { Locale } from './i18n';
import { loadKeys } from './keys';
import { safeReturn } from './login';
import { assertCsrf, getSession } from './sessions';
import type { Session } from './sessions';

export const ACCESS_TOKEN_TTL = 3600;
export const REFRESH_TOKEN_TTL = 30 * 86_400;

/** Authorization-server role only: the MCP Worker is a separate resource server that calls validateToken over RPC. */
export function oauthServer(cfg: Config): OAuthAuthorizationServer<Env> {
  return new OAuthAuthorizationServer<Env>({
    issuer: cfg.authIssuer,
    resources: [cfg.mcpResource],
    scopesSupported: [...SCOPES, 'offline_access'],
    clientRegistrationEndpoint: '/oauth/register',
    // Client ID Metadata Documents need the global_fetch_strictly_public compatibility flag (set in wrangler.jsonc).
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: ACCESS_TOKEN_TTL,
    refreshTokenTTL: REFRESH_TOKEN_TTL
  });
}

/**
 * form-action sources for the consent page. Browsers check form-action on every redirect that follows the form POST,
 * not only on the first one. Some clients hand the code through a relay that redirects again to another origin: Google
 * Gemini's oauth-redirect.googleusercontent.com does. Allowing only the redirect URI origin made the browser silently
 * cancel that second hop after Allow, so the client never received the code. Any https destination is therefore
 * allowed; a non-https redirect URI (loopback http or a custom scheme) is added explicitly. The page itself runs no
 * script (default-src 'none'), escapes all dynamic text and carries a CSRF token, so this does not open a way to post
 * the form elsewhere.
 */
export function formActionFor(redirectUri: string): string[] {
  try {
    const u = new URL(redirectUri);
    if (u.protocol === 'https:') return ['https:'];
    return ['https:', u.protocol === 'http:' ? u.origin : u.protocol];
  } catch {
    return [];
  }
}

const COMPLETED_TTL_SECONDS = 600;

/** KV key marking a consent handle that was approved, so a second submit explains instead of failing. */
async function completedKey(handle: string): Promise<string> {
  return `postun-consent-done:${toBase64Url(await sha256(utf8(handle)))}`;
}

async function markCompleted(env: Env, handle: string): Promise<void> {
  try {
    await env.OAUTH_KV.put(await completedKey(handle), '1', { expirationTtl: COMPLETED_TTL_SECONDS });
  } catch {
    // best effort: without the marker a repeat submit shows the generic stale page
  }
}

async function unmarkCompleted(env: Env, handle: string): Promise<void> {
  try {
    await env.OAUTH_KV.delete(await completedKey(handle));
  } catch {
    // best effort: the mark expires on its own
  }
}

async function wasCompleted(env: Env, handle: string): Promise<boolean> {
  if (handle.length === 0) return false;
  try {
    return (await env.OAUTH_KV.get(await completedKey(handle))) !== null;
  } catch {
    return false;
  }
}

function localError(locale: Locale, message: string, status = 400): Response {
  return html(errorPage(locale, 'INVALID_INPUT', message), status);
}

function loginRedirect(cfg: Config, url: URL): Response {
  return redirect(`${cfg.authIssuer}/login?return=${encodeURIComponent(url.pathname + url.search)}`);
}

/** Cabinet page in the user's language, carrying the pending /authorize request in the fragment as `continue`. */
export function cabinetContinueUrl(cfg: Config, locale: Locale, ret: string): string {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return `${cfg.appOrigin}${prefix}/app/#continue=${encodeURIComponent(ret)}`;
}

function guard(session: Session, cfg: Config, locale: Locale): Response | null {
  void cfg;
  if (session.status !== 'active') return html(errorPage(locale, 'FORBIDDEN', t(locale, 'oauth.suspended')), 403);
  return null;
}

async function showConsent(env: Env, cfg: Config, oauth: OAuthHelpers, req: Request, url: URL, locale: Locale): Promise<Response> {
  let request: AuthRequest;
  try {
    request = await oauth.parseAuthRequest(req);
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectTo) return redirect(err.redirectTo);
    if (err instanceof AuthorizationError) return localError(locale, t(locale, 'oauth.badRequest'));
    if (err instanceof CimdFetchError) return localError(locale, t(locale, 'oauth.clientCheck'));
    throw err;
  }
  const session = await getSession(env, cfg, req);
  if (!session) return loginRedirect(cfg, url);
  const blocked = guard(session, cfg, locale);
  if (blocked) return blocked;
  if (session.termsVersion !== cfg.termsVersion) return redirect(`${cfg.authIssuer}/terms?return=${encodeURIComponent(url.pathname + url.search)}`);

  const accounts = (await listAccounts(env, session.principalId, t(locale, 'account.fallback'))).filter((a) => a.status === 'active');
  if (accounts.length === 0) {
    // No linked Telegram account yet: send the user to the cabinet to link one without leaving the client's sign-in.
    // Only the allow-listed /authorize path+query travels, in the URL fragment (never sent to a server or in Referer);
    // on return GET /authorize re-validates every OAuth parameter, so nothing can be altered on the way.
    const ret = safeReturn(url.pathname + url.search);
    if (ret) return redirect(cabinetContinueUrl(cfg, locale, ret));
    return html(page(locale, t(locale, 'oauth.noAccountsTitle'), `<p>${t(locale, 'oauth.noAccounts', { url: cfg.appOrigin })}</p>`), 409);
  }
  const details = await oauth.describeConsent(request);
  const consent = await oauth.beginConsent(request);

  const requested = normalizeScopes(request.scope);
  const offered = requested.length > 0 ? requested : [...SCOPES];
  // approveConsent() replaces request.scope with what the user ticked, so the offered set is carried in the form,
  // authenticated with a server key and bound to the one-time consent handle.
  const offeredField = [...offered, ...(request.scope.includes('offline_access') ? ['offline_access'] : [])].join(' ');
  const offeredSig = toBase64Url(await hmac((await loadKeys(cfg)).session, 'consent-offered-v1', consent.handle, offeredField));
  const scopeBoxes = offered
    .map((s) => `<label><input type="checkbox" name="scope" value="${esc(s)}"${requested.length > 0 ? ' checked' : ''}> ${esc(scopeLabel(locale, s))}</label>`)
    .join('');
  const accountBoxes = accounts.map((a) => `<label><input type="checkbox" name="account" value="${esc(a.accountId)}"> ${esc(a.label)}</label>`).join('');
  const who = details.clientDomain
    ? t(locale, 'oauth.publisher', { domain: details.clientDomain })
    : t(locale, 'oauth.selfRegistered');
  const loopback = details.redirectIsLoopback ? `<p class="warn">${t(locale, 'oauth.loopback')}</p>` : '';
  const body = page(
    locale,
    t(locale, 'oauth.title'),
    `<p>${t(locale, 'oauth.intro', { client: details.clientName })}</p>
<p>${who} ${t(locale, 'oauth.tokensTo', { host: details.redirectHost })}</p>${loopback}
<form method="post" action="/authorize?lang=${locale}">
<input type="hidden" name="handle" value="${esc(consent.handle)}"><input type="hidden" name="_csrf" value="${esc(session.csrf)}"><input type="hidden" name="offered" value="${esc(offeredField)}"><input type="hidden" name="offered_sig" value="${esc(offeredSig)}">
<div class="box"><strong>${t(locale, 'oauth.accountsTitle')}</strong>${accountBoxes}<small>${t(locale, 'oauth.accountsHint')}</small></div>
<div class="box"><strong>${t(locale, 'oauth.scopesTitle')}</strong>${scopeBoxes}</div>
<p><button type="submit" name="decision" value="approve">${t(locale, 'oauth.approve')}</button> <button type="submit" name="decision" value="deny" class="sec" formnovalidate>${t(locale, 'oauth.deny')}</button></p>
</form>`
  );
  const headers = new Headers(consent.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('content-security-policy', csp(formActionFor(details.redirectUri)));
  writeMetric(env.METRICS, oauthStepPoint('consent_shown'));
  return withSecurityHeaders(new Response(body, { status: 200, headers }));
}

async function decide(env: Env, cfg: Config, oauth: OAuthHelpers, req: Request, locale: Locale): Promise<Response> {
  const session = await getSession(env, cfg, req);
  if (!session) throw new PostunError('UNAUTHENTICATED');
  const form = await req.formData();
  assertCsrf(req, cfg, session, String(form.get('_csrf') ?? ''));
  const blocked = guard(session, cfg, locale);
  if (blocked) return blocked;
  if (session.termsVersion !== cfg.termsVersion) throw new PostunError('FORBIDDEN');
  const handle = String(form.get('handle') ?? '');

  try {
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(req, handle);
      writeMetric(env.METRICS, oauthStepPoint('consent_denied'));
      return withSecurityHeaders(new Response(null, { status: 302, headers: denied.headers }));
    }
    const accountIds = [...new Set(form.getAll('account').map(String))];
    const scopes: Scope[] = normalizeScopes(form.getAll('scope').map(String));
    if (accountIds.length === 0 || accountIds.length > MAX_ACCOUNTS || !accountIds.every((a) => UuidSchema.safeParse(a).success) || scopes.length === 0) {
      writeMetric(env.METRICS, oauthStepPoint('consent_rejected', 'pick_required'));
      return localError(locale, t(locale, 'oauth.pickRequired'));
    }
    const accounts = await ownedActiveAccounts(env, session.principalId, accountIds);
    if (accounts.length !== accountIds.length) {
      writeMetric(env.METRICS, oauthStepPoint('consent_rejected', 'account_unavailable'));
      return localError(locale, t(locale, 'oauth.accountUnavailable'));
    }
    const offeredField = String(form.get('offered') ?? '');
    let sigOk = false;
    try {
      sigOk = await hmacVerify((await loadKeys(cfg)).session, fromBase64Url(String(form.get('offered_sig') ?? '')), 'consent-offered-v1', handle, offeredField);
    } catch {
      sigOk = false;
    }
    const offered = offeredField.split(' ');
    if (!sigOk || !scopes.every((s) => offered.includes(s))) {
      writeMetric(env.METRICS, oauthStepPoint('consent_rejected', 'scopes_not_requested'));
      return localError(locale, t(locale, 'oauth.scopesNotRequested'));
    }

    const approved = await oauth.approveConsent(req, handle, { scope: scopes });
    // The handle is spent from here on. Mark it at once, so a second click that arrives while this request is still
    // creating the grant explains instead of failing; the mark is withdrawn below if the approval does not complete.
    await markCompleted(env, handle);
    try {
      return await finishApproval(env, oauth, session.principalId, approved, accounts, scopes, offered);
    } catch (err) {
      await unmarkCompleted(env, handle);
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthorizationError || err instanceof CimdFetchError) {
      // A second Allow on a page that was already approved (back button, double click) is not an error for the user:
      // the client already has its code. Say so instead of asking to start over, which would only replace the grant.
      if (form.get('decision') === 'approve' && (await wasCompleted(env, handle))) {
        writeMetric(env.METRICS, oauthStepPoint('consent_repeat'));
        return html(page(locale, t(locale, 'oauth.title'), `<p>${t(locale, 'oauth.repeat')}</p>`), 200);
      }
      writeMetric(env.METRICS, oauthStepPoint('consent_stale'));
      return localError(locale, t(locale, 'oauth.stale'));
    }
    throw err;
  }
}

/** Creates the grant and the authorization code for an approved consent; any failure leaves no grant behind. */
async function finishApproval(
  env: Env,
  oauth: OAuthHelpers,
  principalId: string,
  approved: { request: AuthRequest; headers: Headers },
  accounts: Awaited<ReturnType<typeof ownedActiveAccounts>>,
  scopes: Scope[],
  offered: string[]
): Promise<Response> {
  const info = await oauth.lookupClient(approved.request.clientId);
  const clientName = info?.clientName ?? approved.request.clientId;
  // A reconnect of the same client replaces its earlier grant: deny first, then revoke (AU-04 order).
  for (const old of await activeGrantIdsForClient(env, principalId, approved.request.clientId)) {
    await revokeGrant(env, oauth, principalId, old);
  }
  const props = await createGrant(env, principalId, { id: approved.request.clientId, name: clientName }, accounts, scopes);
  const granted: string[] = offered.includes('offline_access') ? [...scopes, 'offline_access'] : [...scopes];
  try {
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: principalId,
      metadata: { grantId: props.grantId },
      scope: granted,
      props: GrantPropsSchema.parse(props),
      revokeExistingGrants: false
    });
    approved.headers.set('Location', redirectTo);
    writeMetric(env.METRICS, oauthStepPoint('consent_approved'));
    return withSecurityHeaders(new Response(null, { status: 302, headers: approved.headers }));
  } catch (err) {
    await revokeGrant(env, oauth, principalId, props.grantId).catch(() => undefined);
    throw err;
  }
}

export async function handleAuthorize(env: Env, cfg: Config, req: Request, url: URL, locale: Locale): Promise<Response> {
  const oauth = oauthServer(cfg).getOAuthApi(env);
  if (req.method === 'GET') return showConsent(env, cfg, oauth, req, url, locale);
  if (req.method === 'POST') return decide(env, cfg, oauth, req, locale);
  return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
}
