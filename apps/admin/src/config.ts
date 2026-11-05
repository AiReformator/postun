import { importAesKey, requireConfig } from '@postun/contracts';
import type { Env } from './env';

export const ROLES = ['postun.viewer', 'postun.operator', 'postun.owner'] as const;
export type Role = (typeof ROLES)[number];

export interface Cfg {
  issuer: string;
  rolesClaim: string;
  rolesTenant: string | null;
  extraAudience: string | null;
  clientId: string;
  clientSecret: string;
  sessionKey: CryptoKey;
  origin: string;
  redirectUri: string;
  postLogoutUri: string;
  requireMfa: boolean;
  mfaAmr: ReadonlySet<string>;
  clientAuth: 'basic' | 'post';
  idTokenAlg: string;
  scope: string;
}

/**
 * The tenant restriction and the extra audience check are required settings: a missing or blank value disables the admin.
 * They can only be switched off explicitly with the literal value "none", so a typo or an empty binding never fails open.
 */
const optOut = (v: string): string | null => (v.trim().toLowerCase() === 'none' ? null : v.trim());

/** Returns null when ANY required value is missing or malformed: the admin is then fully disabled (fail closed). */
export async function loadCfg(env: Env): Promise<Cfg | null> {
  try {
    const r = requireConfig(env as unknown as Record<string, unknown>, 'ADMIN_OIDC_ISSUER', 'ADMIN_OIDC_CLIENT_ID', 'ADMIN_OIDC_CLIENT_SECRET', 'ADMIN_OIDC_SCOPES', 'ADMIN_OIDC_ROLES_CLAIM', 'ADMIN_OIDC_ROLES_TENANT', 'ADMIN_OIDC_EXTRA_AUDIENCE', 'ADMIN_SESSION_KEY', 'ADMIN_ORIGIN') as Record<string, string>;
    const origin = new URL(r.ADMIN_ORIGIN!).origin;
    if (origin !== r.ADMIN_ORIGIN || !origin.startsWith('https://')) return null;
    const issuer = new URL(r.ADMIN_OIDC_ISSUER!);
    if (issuer.protocol !== 'https:' || issuer.search || issuer.hash) return null;
    const scope = r.ADMIN_OIDC_SCOPES!.trim().split(/\s+/).join(' ');
    return {
      issuer: r.ADMIN_OIDC_ISSUER!,
      rolesClaim: r.ADMIN_OIDC_ROLES_CLAIM!.trim(),
      rolesTenant: optOut(r.ADMIN_OIDC_ROLES_TENANT!),
      extraAudience: optOut(r.ADMIN_OIDC_EXTRA_AUDIENCE!),
      clientId: r.ADMIN_OIDC_CLIENT_ID!,
      clientSecret: r.ADMIN_OIDC_CLIENT_SECRET!,
      sessionKey: await importAesKey(r.ADMIN_SESSION_KEY!, 'dek'),
      origin,
      redirectUri: `${origin}/oidc/callback`,
      postLogoutUri: `${origin}/`,
      requireMfa: (env.ADMIN_REQUIRE_MFA_AMR ?? 'true').trim().toLowerCase() !== 'false',
      mfaAmr: new Set((env.ADMIN_MFA_AMR_VALUES ?? 'mfa,otp,hwk,swk,pop').split(',').map((s) => s.trim()).filter(Boolean)),
      clientAuth: env.ADMIN_OIDC_CLIENT_AUTH?.trim().toLowerCase() === 'post' ? 'post' : 'basic',
      idTokenAlg: env.ADMIN_OIDC_ID_TOKEN_ALG?.trim() || 'RS256',
      scope
    };
  } catch {
    return null;
  }
}

/**
 * Roles from the configured claim. With `rolesTenant` the claim must be an object (or array of objects) keyed by role whose
 * value is an object containing the tenant key. Without it the claim may be an array of role strings or an object keyed by role.
 */
export function parseRoles(claims: Record<string, unknown>, cfg: Pick<Cfg, 'rolesClaim' | 'rolesTenant'>): Role[] {
  let raw = Object.hasOwn(claims, cfg.rolesClaim) ? claims[cfg.rolesClaim] : undefined;
  if (cfg.rolesTenant === null && Array.isArray(raw)) {
    const names = new Set<string>();
    for (const x of raw) {
      if (typeof x === 'string') names.add(x);
      else if (x && typeof x === 'object' && !Array.isArray(x)) for (const k of Object.keys(x)) names.add(k);
    }
    return ROLES.filter((role) => names.has(role));
  }
  if (Array.isArray(raw)) raw = Object.assign({}, ...raw.filter((x) => x && typeof x === 'object'));
  if (!raw || typeof raw !== 'object') return [];
  const tenant = cfg.rolesTenant;
  return ROLES.filter((role) => {
    if (!Object.hasOwn(raw, role)) return false;
    if (tenant === null) return true;
    const scopes = (raw as Record<string, unknown>)[role];
    return !!scopes && typeof scopes === 'object' && Object.hasOwn(scopes, tenant);
  });
}

export const roleLevel = (roles: readonly Role[]): Role | null => [...ROLES].reverse().find((r) => roles.includes(r)) ?? null;
export const rank = (r: Role): number => ROLES.indexOf(r);
