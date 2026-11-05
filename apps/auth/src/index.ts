import { WorkerEntrypoint } from 'cloudflare:workers';
import { GrantPropsSchema } from '@postun/contracts';
import type { AuthServerRpc, ValidatedToken } from '@postun/contracts';
import { handleRequest } from './app';
import { runScheduled } from './cron';
import { loadConfig } from './env';
import type { Env } from './env';
import { oauthServer } from './oauth';

/**
 * Default entrypoint of postun-auth: public HTTP (fetch), the RPC used by postun-mcp (validateToken),
 * and the hourly retention job (scheduled).
 */
export default class AuthServer extends WorkerEntrypoint<Env> implements AuthServerRpc {
  override fetch(request: Request): Promise<Response> {
    return handleRequest(request, this.env, this.ctx);
  }

  async validateToken(resource: string, token: string): Promise<ValidatedToken | null> {
    const cfg = loadConfig(this.env);
    const result = await oauthServer(cfg).validateToken(resource, token, this.env);
    if (!result) return null;
    const props = GrantPropsSchema.safeParse(result.props);
    if (!props.success) return null; // fail closed on unexpected props
    return { props: props.data, audience: result.audience, expiresAt: result.expiresAt, scope: result.scope, userId: result.userId, clientId: result.clientId };
  }

  override async scheduled(): Promise<void> {
    await runScheduled(this.env);
  }
}

export { AdminControl } from './admin';
