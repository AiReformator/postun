import { importAesKey, requireConfig } from '@postun/contracts';
import type { Env } from './env';

export const ROLES = ['postun.viewer', 'postun.operator', 'postun.owner'] as const;
export type Role = (typeof ROLES)[number];

export interface Cfg {
  issuer: string;
  projectId: string;
  orgId: string;
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

/** Returns null when ANY required value is missing or malformed: the admin is then fully disabled (fail closed). */
export async function loadCfg(env: Env): Promise<Cfg | null> {
  try {
    const r = requireConfig(env as unknown as Record<string, unknown>, 'IDP_ISSUER', 'IDP_PROJECT_ID', 'IDP_ORG_ID', 'IDP_CLIENT_ID', 'IDP_CLIENT_SECRET', 'ADMIN_SESSION_KEY', 'ADMIN_ORIGIN') as Record<string, string>;
    const origin = new URL(r.ADMIN_ORIGIN!).origin;
    if (origin !== r.ADMIN_ORIGIN || !origin.startsWith('https://')) return null;
    const issuer = new URL(r.IDP_ISSUER!);
    if (issuer.protocol !== 'https:' || issuer.search || issuer.hash) return null;
    const projectId = r.IDP_PROJECT_ID!;
    const orgId = r.IDP_ORG_ID!;
    const scope =
      env.IDP_SCOPES?.trim() ||
      // Reserved scopes verified against https://idp.com/docs/apis/openidoauth/scopes (offline_access = refresh token).
      ['openid', 'profile', 'offline_access', `urn:idp:iam:org:project:id:${projectId}:aud`, 'urn:idp:iam:org:projects:roles', `urn:idp:iam:org:id:${orgId}`].join(' ');
    return {
      issuer: r.IDP_ISSUER!,
      projectId,
      orgId,
      clientId: r.IDP_CLIENT_ID!,
      clientSecret: r.IDP_CLIENT_SECRET!,
      sessionKey: await importAesKey(r.ADMIN_SESSION_KEY!, 'dek'),
      origin,
      redirectUri: `${origin}/oidc/callback`,
      postLogoutUri: `${origin}/`,
      requireMfa: (env.ADMIN_REQUIRE_MFA_AMR ?? 'true').trim().toLowerCase() !== 'false',
      mfaAmr: new Set((env.ADMIN_MFA_AMR_VALUES ?? 'mfa,otp,hwk,swk,pop').split(',').map((s) => s.trim()).filter(Boolean)),
      clientAuth: env.IDP_CLIENT_AUTH?.trim().toLowerCase() === 'post' ? 'post' : 'basic',
      idTokenAlg: env.IDP_ID_TOKEN_ALG?.trim() || 'RS256',
      scope
    };
  } catch {
    return null;
  }
}

/** Roles from the IDP claim urn:idp:iam:org:project:{projectId}:roles, restricted to the configured org. */
export function parseRoles(claims: Record<string, unknown>, cfg: Pick<Cfg, 'projectId' | 'orgId'>): Role[] {
  let raw = claims[`urn:idp:iam:org:project:${cfg.projectId}:roles`];
  if (Array.isArray(raw)) raw = Object.assign({}, ...raw.filter((x) => x && typeof x === 'object'));
  if (!raw || typeof raw !== 'object') return [];
  return ROLES.filter((role) => {
    const orgs = Object.hasOwn(raw, role) ? (raw as Record<string, unknown>)[role] : undefined;
    return !!orgs && typeof orgs === 'object' && Object.hasOwn(orgs, cfg.orgId);
  });
}

export const roleLevel = (roles: readonly Role[]): Role | null => [...ROLES].reverse().find((r) => roles.includes(r)) ?? null;
export const rank = (r: Role): number => ROLES.indexOf(r);
