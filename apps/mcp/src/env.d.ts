import type { AdminProjection, AuthServerRpc, MetricsDataset, ProjectionSinkRpc } from '@postun/contracts';
import type { SessionAndQuotaDO } from './do/session-do';

/** Typed service binding: only the RPC methods of the contract are visible. */
export type RpcService<T> = Fetcher & { [K in keyof T]: T[K] };

export interface Env {
  // bindings
  SESSIONS: DurableObjectNamespace<SessionAndQuotaDO>;
  AUTH: RpcService<AuthServerRpc>;
  ADMIN_SINK?: RpcService<ProjectionSinkRpc>;
  /** Workers Analytics Engine dataset for aggregate service metrics; optional, writes are best effort. */
  METRICS?: MetricsDataset;
  // vars
  APP_ENV: string;
  MCP_RESOURCE: string;
  AUTH_ISSUER: string;
  BETA_MONTHLY_SUCCESS_LIMIT: string;
  BETA_MONTHLY_BYTE_LIMIT?: string;
  BETA_DAILY_SUCCESS_LIMIT?: string;
  MAX_FILE_BYTES: string;
  FEATURE_CHANNELS: string;
  TELEGRAM_ADAPTER: string;
  // pacing and flood protection: initial tunable guesses, all optional (defaults in do/limiter.ts and telegram/mtcute.ts)
  PACING_BURST?: string;
  PACING_REFILL_MS?: string;
  PACING_HOURLY_CAP?: string;
  PACING_LOOKUP_PER_MIN?: string;
  PACING_LOOKUP_PER_DAY?: string;
  PACING_MESSAGES_PER_HOUR?: string;
  PACING_FLOOD_MARGIN_SECONDS?: string;
  FLOOD_AUTO_SLEEP_SECONDS?: string;
  FLOOD_AUTO_RETRIES?: string;
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
