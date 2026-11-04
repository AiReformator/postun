import { WorkerEntrypoint } from 'cloudflare:workers';
import { PostunError, type GrantRecord, type LinkState, type UsageView, type VaultControlRpc } from '@postun/contracts';
import type { Env } from './env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Service-binding entrypoint used only by postun-auth ({binding VAULT, entrypoint "VaultControl"}).
 * It has no fetch handler, so it is not reachable over HTTP. principalId is trusted because the
 * binding is private; it is still shape-checked here and bound inside the DO.
 */
export class VaultControl extends WorkerEntrypoint<Env> implements VaultControlRpc {
  private stub(principalId: string) {
    if (!UUID_RE.test(principalId)) throw new PostunError('INVALID_INPUT');
    return this.env.SESSIONS.get(this.env.SESSIONS.idFromName(principalId));
  }
  startLink(principalId: string, accountId: string): Promise<LinkState> {
    return this.stub(principalId).startLink(principalId, accountId);
  }
  linkStatus(principalId: string, accountId: string): Promise<LinkState> {
    return this.stub(principalId).linkStatus(principalId, accountId);
  }
  submitPassword(principalId: string, accountId: string, password: string): Promise<LinkState> {
    return this.stub(principalId).submitPassword(principalId, accountId, password);
  }
  activateAccount(principalId: string, accountId: string): Promise<{ ok: true }> {
    return this.stub(principalId).activateAccount(principalId, accountId);
  }
  disconnectAccount(principalId: string, accountId: string): Promise<{ telegramLoggedOut: boolean }> {
    return this.stub(principalId).disconnectAccount(principalId, accountId);
  }
  putGrant(principalId: string, grant: GrantRecord): Promise<{ ok: true }> {
    return this.stub(principalId).putGrant(principalId, grant);
  }
  denyGrant(principalId: string, grantId: string): Promise<{ ok: true }> {
    return this.stub(principalId).denyGrant(principalId, grantId);
  }
  setSuspended(principalId: string, suspended: boolean): Promise<{ ok: true }> {
    return this.stub(principalId).setSuspended(principalId, suspended);
  }
  deletePrincipal(principalId: string): Promise<{ ok: true; revocationPending: boolean }> {
    return this.stub(principalId).deletePrincipal(principalId);
  }
  getUsage(principalId: string): Promise<UsageView> {
    return this.stub(principalId).getUsage(principalId);
  }
}
