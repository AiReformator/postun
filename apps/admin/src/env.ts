import type { AdminControlRpc } from '@postun/contracts';

export interface Env {
  ADMIN_DB: D1Database;
  /** postun-auth entrypoint AdminControl: suspend/resume only. */
  CONTROL: AdminControlRpc;
  APP_ENV?: string;
  ADMIN_ORIGIN?: string;
  ADMIN_OIDC_ISSUER?: string;
  ADMIN_OIDC_CLIENT_ID?: string;
  ADMIN_OIDC_CLIENT_SECRET?: string;
  /** Required: the full space-separated scope string (no built-in default). */
  ADMIN_OIDC_SCOPES?: string;
  /** Required: name of the claim (ID token / userinfo) that carries the administrator roles. */
  ADMIN_OIDC_ROLES_CLAIM?: string;
  /** Optional: when set, a role counts only if its value is an object containing this key. */
  ADMIN_OIDC_ROLES_TENANT: string;
  /** Optional: when set, the ID token `aud` must include this value (in addition to the client id). */
  ADMIN_OIDC_EXTRA_AUDIENCE: string;
  ADMIN_SESSION_KEY?: string;
  /** "true" (default) requires a strong amr value in the ID token. */
  ADMIN_REQUIRE_MFA_AMR?: string;
  /** Comma-separated accepted amr values. */
  ADMIN_MFA_AMR_VALUES?: string;
  /** "basic" (default) or "post". */
  ADMIN_OIDC_CLIENT_AUTH?: string;
  /** Expected ID token signature algorithm (default RS256). */
  ADMIN_OIDC_ID_TOKEN_ALG?: string;
}
