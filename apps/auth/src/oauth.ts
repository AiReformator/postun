import { AuthorizationError, CimdFetchError, OAuthAuthorizationServer } from '@cloudflare/workers-oauth-provider';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { GrantPropsSchema, hmac, hmacVerify, fromBase64Url, normalizeScopes, PostunError, SCOPES, toBase64Url, UuidSchema, withSecurityHeaders } from '@postun/contracts';
import type { Scope } from '@postun/contracts';
import { activeGrantIdsForClient, createGrant, ownedActiveAccounts, revokeGrant } from './grants';
import type { Config, Env } from './env';
import { csp, errorPage, esc, html, page, redirect } from './http';
import { listAccounts, MAX_ACCOUNTS } from './accounts';
import { scopeLabel, t } from './i18n';
import type { Locale } from './i18n';
import { loadKeys } from './keys';
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

function formActionFor(redirectUri: string): string[] {
  try {
    const u = new URL(redirectUri);
    return [u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : u.protocol];
  } catch {
    return [];
  }
}

function localError(locale: Locale, message: string, status = 400): Response {
  return html(errorPage(locale, 'INVALID_INPUT', message), status);
}

function loginRedirect(cfg: Config, url: URL): Response {
  return redirect(`${cfg.authIssuer}/login?return=${encodeURIComponent(url.pathname + url.search)}`);
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
      return withSecurityHeaders(new Response(null, { status: 302, headers: denied.headers }));
    }
    const accountIds = [...new Set(form.getAll('account').map(String))];
    const scopes: Scope[] = normalizeScopes(form.getAll('scope').map(String));
    if (accountIds.length === 0 || accountIds.length > MAX_ACCOUNTS || !accountIds.every((a) => UuidSchema.safeParse(a).success) || scopes.length === 0) {
      return localError(locale, t(locale, 'oauth.pickRequired'));
    }
    const accounts = await ownedActiveAccounts(env, session.principalId, accountIds);
    if (accounts.length !== accountIds.length) return localError(locale, t(locale, 'oauth.accountUnavailable'));
    const offeredField = String(form.get('offered') ?? '');
    let sigOk = false;
    try {
      sigOk = await hmacVerify((await loadKeys(cfg)).session, fromBase64Url(String(form.get('offered_sig') ?? '')), 'consent-offered-v1', handle, offeredField);
    } catch {
      sigOk = false;
    }
    const offered = offeredField.split(' ');
    if (!sigOk || !scopes.every((s) => offered.includes(s))) return localError(locale, t(locale, 'oauth.scopesNotRequested'));

    const approved = await oauth.approveConsent(req, handle, { scope: scopes });

    const info = await oauth.lookupClient(approved.request.clientId);
    const clientName = info?.clientName ?? approved.request.clientId;
    // A reconnect of the same client replaces its earlier grant: deny first, then revoke (AU-04 order).
    for (const old of await activeGrantIdsForClient(env, session.principalId, approved.request.clientId)) {
      await revokeGrant(env, oauth, session.principalId, old);
    }
    const props = await createGrant(env, session.principalId, { id: approved.request.clientId, name: clientName }, accounts, scopes);
    const granted: string[] = offered.includes('offline_access') ? [...scopes, 'offline_access'] : [...scopes];
    try {
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: session.principalId,
        metadata: { grantId: props.grantId },
        scope: granted,
        props: GrantPropsSchema.parse(props),
        revokeExistingGrants: false
      });
      approved.headers.set('Location', redirectTo);
      return withSecurityHeaders(new Response(null, { status: 302, headers: approved.headers }));
    } catch (err) {
      await revokeGrant(env, oauth, session.principalId, props.grantId).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthorizationError || err instanceof CimdFetchError) return localError(locale, t(locale, 'oauth.stale'));
    throw err;
  }
}

export async function handleAuthorize(env: Env, cfg: Config, req: Request, url: URL, locale: Locale): Promise<Response> {
  const oauth = oauthServer(cfg).getOAuthApi(env);
  if (req.method === 'GET') return showConsent(env, cfg, oauth, req, url, locale);
  if (req.method === 'POST') return decide(env, cfg, oauth, req, locale);
  return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
}
