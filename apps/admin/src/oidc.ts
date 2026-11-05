import * as o from 'oauth4webapi';
import { parseRoles, type Cfg, type Role } from './config';

/** Thrown for a successful identity provider response that must not grant access (maps to HTTP 403). */
export class Denied extends Error {
  constructor(readonly reason: 'no_role' | 'mfa_required', readonly subject: string) {
    super(reason);
  }
}
/** The identity provider (discovery/token/JWKS) unreachable or malformed: admin stays closed (HTTP 503). */
export class IdpUnavailable extends Error {}

let cache: { issuer: string; as: o.AuthorizationServer; exp: number } | undefined;
export const resetDiscoveryCache = (): void => {
  cache = undefined;
};

export async function discover(cfg: Cfg): Promise<o.AuthorizationServer> {
  if (cache && cache.issuer === cfg.issuer && cache.exp > Date.now()) return cache.as;
  try {
    const issuer = new URL(cfg.issuer);
    const as = await o.processDiscoveryResponse(issuer, await o.discoveryRequest(issuer, { algorithm: 'oidc' }));
    if (!as.authorization_endpoint || !as.token_endpoint || !as.jwks_uri) throw new Error('incomplete discovery');
    if (as.code_challenge_methods_supported && !as.code_challenge_methods_supported.includes('S256')) throw new Error('no S256');
    cache = { issuer: cfg.issuer, as, exp: Date.now() + 10 * 60_000 };
    return as;
  } catch {
    throw new IdpUnavailable();
  }
}

const client = (cfg: Cfg): o.Client => ({ client_id: cfg.clientId, id_token_signed_response_alg: cfg.idTokenAlg });
const clientAuth = (cfg: Cfg): o.ClientAuth => (cfg.clientAuth === 'post' ? o.ClientSecretPost(cfg.clientSecret) : o.ClientSecretBasic(cfg.clientSecret));

export async function authorizationUrl(cfg: Cfg, as: o.AuthorizationServer, p: { state: string; nonce: string; verifier: string }): Promise<string> {
  const u = new URL(as.authorization_endpoint!);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', cfg.scope);
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', await o.calculatePKCECodeChallenge(p.verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export const newLoginParams = () => ({ state: o.generateRandomState(), nonce: o.generateRandomNonce(), verifier: o.generateRandomCodeVerifier() });

/** Roles come from the ID token when the provider asserts them there, otherwise from the userinfo endpoint. */
async function rolesFor(cfg: Cfg, as: o.AuthorizationServer, tokens: o.TokenEndpointResponse, claims: o.IDToken | undefined, sub: string): Promise<Role[]> {
  if (claims && Object.hasOwn(claims, cfg.rolesClaim)) return parseRoles(claims, cfg);
  const res = await o.userInfoRequest(as, client(cfg), tokens.access_token);
  return parseRoles(await o.processUserInfoResponse(as, client(cfg), sub, res), cfg);
}

export interface LoginResult {
  subject: string;
  issuer: string;
  roles: Role[];
  mfa: boolean;
  refreshToken: string | null;
}

/** Code exchange + full ID token validation. Throws Denied (403), IdpUnavailable (503) or any other error (400). */
export async function completeLogin(cfg: Cfg, as: o.AuthorizationServer, url: URL, st: { state: string; nonce: string; verifier: string }): Promise<LoginResult> {
  const c = client(cfg);
  const params = o.validateAuthResponse(as, c, url.searchParams, st.state);
  let response: Response;
  try {
    response = await o.authorizationCodeGrantRequest(as, c, clientAuth(cfg), params, cfg.redirectUri, st.verifier);
  } catch (e) {
    if (e instanceof TypeError) throw new IdpUnavailable();
    throw e;
  }
  // Validates issuer (exact), audience incl. client_id, azp, nonce, exp/iat and the configured alg.
  const tokens = await o.processAuthorizationCodeResponse(as, c, response, { expectedNonce: st.nonce, requireIdToken: true });
  // Defence in depth: verify the signature against the issuer's JWKS as well.
  await o.validateApplicationLevelSignature(as, response);
  const claims = o.getValidatedIdTokenClaims(tokens);
  if (!claims) throw new Error('no id token');
  if (cfg.extraAudience && !([] as string[]).concat(claims.aud).includes(cfg.extraAudience)) throw new Error('audience lacks required value');
  const amr = Array.isArray(claims.amr) ? claims.amr.filter((x): x is string => typeof x === 'string') : [];
  const mfa = amr.some((v) => cfg.mfaAmr.has(v));
  if (cfg.requireMfa && !mfa) throw new Denied('mfa_required', claims.sub);
  const roles = await rolesFor(cfg, as, tokens, claims, claims.sub);
  if (roles.length === 0) throw new Denied('no_role', claims.sub);
  return { subject: claims.sub, issuer: cfg.issuer, roles, mfa, refreshToken: tokens.refresh_token ?? null };
}

export type RefreshResult = { status: 'ok'; roles: Role[]; refreshToken: string | null } | { status: 'revoked' } | { status: 'unavailable' };

/** Fresh authorization: refresh_token grant, then re-read the roles from the NEW token (or userinfo). */
export async function refreshRoles(cfg: Cfg, subject: string, refreshToken: string): Promise<RefreshResult> {
  try {
    const as = await discover(cfg);
    const c = client(cfg);
    const response = await o.refreshTokenGrantRequest(as, c, clientAuth(cfg), refreshToken);
    const tokens = await o.processRefreshTokenResponse(as, c, response);
    let claims: o.IDToken | undefined;
    if (tokens.id_token) {
      await o.validateApplicationLevelSignature(as, response);
      claims = o.getValidatedIdTokenClaims(tokens);
      if (!claims || claims.sub !== subject) return { status: 'revoked' };
    }
    const roles = await rolesFor(cfg, as, tokens, claims, subject);
    return roles.length ? { status: 'ok', roles, refreshToken: tokens.refresh_token ?? null } : { status: 'revoked' };
  } catch (e) {
    if (e instanceof o.ResponseBodyError && (e.error === 'invalid_grant' || e.error === 'invalid_token')) return { status: 'revoked' };
    return { status: 'unavailable' };
  }
}

export async function endSessionUrl(cfg: Cfg): Promise<string | null> {
  try {
    const as = await discover(cfg);
    if (!as.end_session_endpoint) return null;
    const u = new URL(as.end_session_endpoint);
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('post_logout_redirect_uri', cfg.postLogoutUri);
    return u.toString();
  } catch {
    return null;
  }
}
