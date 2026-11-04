import type { AdminProjection, AuthServerRpc, ProjectionSinkRpc } from '@postun/contracts';
import type { SessionAndQuotaDO } from './do/session-do';

/** Typed service binding: only the RPC methods of the contract are visible. */
export type RpcService<T> = Fetcher & { [K in keyof T]: T[K] };

export interface Env {
  // bindings
  SESSIONS: DurableObjectNamespace<SessionAndQuotaDO>;
  AUTH: RpcService<AuthServerRpc>;
  ADMIN_SINK?: RpcService<ProjectionSinkRpc>;
  // vars
  APP_ENV: string;
  MCP_RESOURCE: string;
  AUTH_ISSUER: string;
  BETA_MONTHLY_SUCCESS_LIMIT: string;
  BETA_MONTHLY_BYTE_LIMIT?: string;
  MAX_FILE_BYTES: string;
  FEATURE_CHANNELS: string;
  TELEGRAM_ADAPTER: string;
  // secrets (never in wrangler.jsonc; see .dev.vars.example)
  TELEGRAM_API_ID?: string;
  TELEGRAM_API_HASH?: string;
  SESSION_KEK?: string;
  SESSION_KEK_VERSION?: string;
  SESSION_KEK_PREVIOUS?: string;
  SESSION_KEK_PREVIOUS_VERSION?: string;
  CURSOR_HMAC_KEY?: string;
}

export type { AdminProjection };

// Types `import { env, exports } from 'cloudflare:workers'` (used by the tests).
declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends Omit<import('./env').Env, never> {}
    interface GlobalProps {
      mainModule: typeof import('./index');
    }
  }
}
