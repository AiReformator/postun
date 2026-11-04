import type { AdminControlRpc } from '@postun/contracts';

export interface Env {
  ADMIN_DB: D1Database;
  /** postun-auth entrypoint AdminControl: suspend/resume only. */
  CONTROL: AdminControlRpc;
  APP_ENV?: string;
  ADMIN_ORIGIN?: string;
  IDP_ISSUER?: string;
  IDP_PROJECT_ID?: string;
  IDP_ORG_ID?: string;
  IDP_CLIENT_ID?: string;
  IDP_CLIENT_SECRET?: string;
  ADMIN_SESSION_KEY?: string;
  /** "true" (default) requires a strong amr value in the ID token. */
  ADMIN_REQUIRE_MFA_AMR?: string;
  /** Comma-separated accepted amr values. */
  ADMIN_MFA_AMR_VALUES?: string;
  /** "basic" (default) or "post". */
  IDP_CLIENT_AUTH?: string;
  IDP_ID_TOKEN_ALG?: string;
  /** Overrides the computed scope string. */
  IDP_SCOPES?: string;
}
