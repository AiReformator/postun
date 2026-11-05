import { describe, expect, it } from 'vitest';
import { callTool, errCode, makeToken, mcpRequest, principalStub, setupWorld } from './helpers';
import { syntheticControl } from '../src/telegram/synthetic';

describe('AU-01 authentication happens before any upstream call', () => {
  it('rejects a request without a token with 401 and a resource metadata challenge', async () => {
    syntheticControl.reset();
    const res = await mcpRequest(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata');
    expect(syntheticControl.opens).toBe(0);
  });

  it('rejects a token that the auth server does not know', async () => {
    syntheticControl.reset();
    const res = await mcpRequest('garbage-token', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(syntheticControl.opens).toBe(0);
  });

  it('rejects a token issued for another resource (audience mismatch)', async () => {
    const w = await setupWorld();
    const wrong = makeToken(w.props, 'https://other.example/mcp');
    const res = await mcpRequest(wrong, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(syntheticControl.opens).toBe(0);
  });

  it('rejects props that do not match the grant schema with 403, before the DO', async () => {
    syntheticControl.reset();
    const bad = makeToken({ principalId: 'not-a-uuid', accounts: ['x'], scopes: ['admin:everything'] });
    const res = await mcpRequest(bad, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(403);
    expect(syntheticControl.opens).toBe(0);
  });
});

describe('AU-02 account, principal and cursor substitution', () => {
  it('refuses an account_id that is not in the grant', async () => {
    const w = await setupWorld();
    const foreign = crypto.randomUUID();
    const r = await callTool(w.token, 'list_dialogs', { account_id: foreign });
    expect(errCode(r)).toBe('ACCOUNT_NOT_IN_GRANT');
    expect(syntheticControl.opens).toBe(0);
  });

  it('refuses an account owned by another principal even if the token claims it', async () => {
    const a = await setupWorld();
    const b = await setupWorld();
    // Token for principal A that lists B's account id in its own props.
    const forged = makeToken({ ...a.props, accounts: [...a.props.accounts, ...b.accountIds] });
    const r = await callTool(forged, 'list_dialogs', { account_id: b.accountIds[0] });
    expect(errCode(r)).toBe('ACCOUNT_NOT_IN_GRANT');
  });

  it('a principal id in a token cannot reach another principal data', async () => {
    const a = await setupWorld();
    const b = await setupWorld();
    // Valid-shaped props pointing at B's principal but with A's grant: no such grant in B's DO.
    const forged = makeToken({ ...a.props, principalId: b.principalId });
    const r = await callTool(forged, 'list_dialogs', { account_id: a.accountIds[0] });
    expect(r.isError).toBe(true);
    expect(syntheticControl.opens).toBe(0);
  });

  it('rejects a forged cursor', async () => {
    const w = await setupWorld();
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0], cursor: 'AAAA.BBBB' });
    expect(errCode(r)).toBe('INVALID_CURSOR');
  });

  it('rejects a cursor replayed on another account or another tool', async () => {
    const w = await setupWorld({ accounts: 2 });
    const [a1, a2] = w.accountIds as [string, string];
    const page = await callTool(w.token, 'list_dialogs', { account_id: a1, limit: 10 });
    const cursor = page.data.nextCursor as string;
    expect(cursor).toBeTruthy();
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: a2, cursor }))).toBe('INVALID_CURSOR');
    const peer = (page.data.dialogs as { peerId: string }[])[0]?.peerId as string;
    expect(errCode(await callTool(w.token, 'get_history', { account_id: a1, peer, cursor }))).toBe('INVALID_CURSOR');
    // And it still works where it was issued.
    expect((await callTool(w.token, 'list_dialogs', { account_id: a1, limit: 10, cursor })).isError).toBe(false);
  });

  it('keeps accounts of one grant apart: each sees its own synthetic data', async () => {
    const w = await setupWorld({ accounts: 2 });
    const [a1, a2] = w.accountIds as [string, string];
    const d1 = await callTool(w.token, 'list_dialogs', { account_id: a1, limit: 1 });
    const d2 = await callTool(w.token, 'list_dialogs', { account_id: a2, limit: 1 });
    expect((d1.data.dialogs as { peerId: string }[])[0]?.peerId).not.toBe((d2.data.dialogs as { peerId: string }[])[0]?.peerId);
  });
});

describe('AU-03 accounts added after the grant', () => {
  it('a new account is not reachable with an old grant and token', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    const later = crypto.randomUUID();
    await stub.startLink(w.principalId, later);
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 10));
      if ((await stub.linkStatus(w.principalId, later)).state === 'authorized') break;
    }
    await stub.activateAccount(w.principalId, later);
    // Even a token that (wrongly) lists the new account is bounded by the authoritative grant.
    const widened = makeToken({ ...w.props, accounts: [...w.props.accounts, later] });
    expect(errCode(await callTool(widened, 'list_dialogs', { account_id: later }))).toBe('ACCOUNT_NOT_IN_GRANT');
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: later }))).toBe('ACCOUNT_NOT_IN_GRANT');
    const listed = (await callTool(widened, 'list_accounts', {})).data.accounts as { accountId: string }[];
    expect(listed.map((a) => a.accountId)).toEqual(w.accountIds);
  });
});

describe('AU-04 revocation is authoritative in the DO', () => {
  it('denyGrant makes a still-valid token fail with GRANT_REVOKED', async () => {
    const w = await setupWorld();
    expect((await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] })).isError).toBe(false);
    await principalStub(w.principalId).denyGrant(w.principalId, w.grantId);
    const r = await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] });
    expect(errCode(r)).toBe('GRANT_REVOKED');
    syntheticControl.opens = 0;
    expect(errCode(await callTool(w.token, 'list_accounts', {}))).toBe('GRANT_REVOKED');
    expect(syntheticControl.opens).toBe(0);
  });

  it('putGrant cannot resurrect a denied grant, and deny before putGrant sticks', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    await stub.denyGrant(w.principalId, w.grantId);
    await stub.putGrant(w.principalId, { grantId: w.grantId, accounts: w.accountIds, scopes: w.props.scopes, version: 99 });
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] }))).toBe('GRANT_REVOKED');
    const early = crypto.randomUUID();
    await stub.denyGrant(w.principalId, early);
    await stub.putGrant(w.principalId, { grantId: early, accounts: w.accountIds, scopes: w.props.scopes, version: 1 });
    const t = makeToken({ ...w.props, grantId: early });
    expect(errCode(await callTool(t, 'list_accounts', {}))).toBe('GRANT_REVOKED');
  });

  it('a token with a newer grant version than the DO knows is refused (fail closed)', async () => {
    const w = await setupWorld();
    const t = makeToken({ ...w.props, grantVersion: 5 });
    expect(errCode(await callTool(t, 'list_accounts', {}))).toBe('FORBIDDEN');
  });

  it('enforces tool scope server-side', async () => {
    const w = await setupWorld({ scopes: ['accounts:read', 'dialogs:read'] });
    expect(errCode(await callTool(w.token, 'get_history', { account_id: w.accountIds[0], peer: 'u:1:1' }))).toBe('FORBIDDEN');
    expect((await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] })).isError).toBe(false);
    // Token claims more than the grant allows: the grant wins.
    const wide = makeToken({ ...w.props, scopes: ['accounts:read', 'dialogs:read', 'messages:read'] });
    expect(errCode(await callTool(wide, 'get_history', { account_id: w.accountIds[0], peer: 'u:1:1' }))).toBe('FORBIDDEN');
  });

  it('suspension stops all access and resume restores it', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    await stub.setSuspended(w.principalId, true);
    expect(errCode(await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] }))).toBe('FORBIDDEN');
    await stub.setSuspended(w.principalId, false);
    expect((await callTool(w.token, 'list_dialogs', { account_id: w.accountIds[0] })).isError).toBe(false);
  });

  it('a pending (not yet activated) account is not usable', async () => {
    const w = await setupWorld();
    const stub = principalStub(w.principalId);
    const pending = crypto.randomUUID();
    await stub.startLink(w.principalId, pending);
    await stub.putGrant(w.principalId, { grantId: w.grantId, accounts: [...w.accountIds, pending], scopes: w.props.scopes, version: 2 });
    const t = makeToken({ ...w.props, accounts: [...w.accountIds, pending], grantVersion: 2 });
    expect(errCode(await callTool(t, 'list_dialogs', { account_id: pending }))).toBe('ACCOUNT_NOT_ACTIVE');
  });
});
