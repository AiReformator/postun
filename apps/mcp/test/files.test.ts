import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { signFileCapability } from '../src/capability';
import { syntheticControl } from '../src/telegram/synthetic';
import { callTool, errCode, fetchFile, parseDownload, principalStub, setupWorld, type World } from './helpers';

const BIG_OK = 10; // 2.5 MB document in the synthetic account
const TOO_BIG = 20; // 9 MB document, above the 5 MB test limit
const PEER = 'c:1000:7';

async function issue(w: World, messageId = BIG_OK) {
  const r = await callTool(w.token, 'get_media', { account_id: w.accountIds[0], peer: PEER, message_id: messageId });
  return r;
}

async function bytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

const expectedByte = (i: number) => (i * 31 + 7) & 0xff;

describe('get_media and the download endpoint', () => {
  it('F-02: a file above the configured maximum is rejected before any byte is requested', async () => {
    const w = await setupWorld();
    const r = await issue(w, TOO_BIG);
    expect(errCode(r)).toBe('FILE_TOO_LARGE');
    const rows = await runInDurableObject(principalStub(w.principalId), (_i, s) => s.storage.sql.exec('SELECT COUNT(*) AS n FROM transfers').one().n);
    expect(rows).toBe(0);
  });

  it('issues a hashed capability and streams the whole file with safe headers', async () => {
    const w = await setupWorld();
    const r = await issue(w);
    expect(r.isError).toBe(false);
    const d = parseDownload(r);
    expect(d.url).toBe(`https://mcp.test/files/${d.intentId}`);
    expect(d.url).not.toContain(d.capability);
    // Only the SHA-256 hash is stored, never the capability.
    const dump = await runInDurableObject(principalStub(w.principalId), (_i, s) => JSON.stringify(s.storage.sql.exec('SELECT * FROM transfers').toArray()));
    expect(dump).not.toContain(d.capability.split('.')[1]);
    const res = await fetchFile(d.intentId, d.capability);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="SYNTH-FILE-10\.bin"/);
    const body = await bytes(res);
    expect(body.length).toBe(2_500_000);
    expect(body[0]).toBe(expectedByte(0));
    expect(body[1_234_567]).toBe(expectedByte(1_234_567));
    const usage = await principalStub(w.principalId).getUsage(w.principalId);
    expect(usage.outBytes).toBe(2_500_000);
    expect(usage.successCount).toBe(1); // the get_media call; the download itself adds bytes, not operations
  });

  it('honours Range and rejects unsatisfiable or multi ranges', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    const part = await fetchFile(d.intentId, d.capability, 'bytes=100-199');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 100-199/2500000');
    const b = await bytes(part);
    expect(b.length).toBe(100);
    expect(b[0]).toBe(expectedByte(100));
    const suffix = await fetchFile(d.intentId, d.capability, 'bytes=-10');
    expect(suffix.status).toBe(206);
    expect((await bytes(suffix))[0]).toBe(expectedByte(2_499_990));
    expect((await fetchFile(d.intentId, d.capability, 'bytes=9999999-')).status).toBe(416);
    expect((await fetchFile(d.intentId, d.capability, 'bytes=0-1,5-6')).status).toBe(416);
    expect((await fetchFile(d.intentId, d.capability, 'bytes=abc')).status).toBe(416);
  });

  it('Q-03: counts exactly the bytes delivered, including repeated ranges', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    await bytes(await fetchFile(d.intentId, d.capability, 'bytes=0-99'));
    await bytes(await fetchFile(d.intentId, d.capability, 'bytes=0-99'));
    await bytes(await fetchFile(d.intentId, d.capability, 'bytes=1000-1049'));
    expect((await principalStub(w.principalId).getUsage(w.principalId)).outBytes).toBe(250);
  });

  it('Q-03: a client that cancels early is charged for what was handed out, not the whole file', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    const res = await fetchFile(d.intentId, d.capability);
    const reader = res.body!.getReader();
    const first = await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));
    const out = (await principalStub(w.principalId).getUsage(w.principalId)).outBytes;
    expect(out).toBeGreaterThanOrEqual(first.value!.length);
    expect(out).toBeLessThan(2_500_000);
  });

  it('F-03: the capability is not accepted in the query string', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    const res = await fetchFile(d.intentId, null, undefined, `?capability=${d.capability}&token=${d.capability}`);
    expect(res.status).toBe(401);
    expect((await res.text()).length).toBeLessThan(300);
  });

  it('F-03: wrong secret, foreign principal and unknown intent are rejected', async () => {
    const a = await setupWorld();
    const b = await setupWorld();
    const d = parseDownload(await issue(a));
    const [, secret] = d.capability.split('.') as [string, string];
    expect((await fetchFile(d.intentId, `${a.principalId}.${'A'.repeat(43)}`)).status).toBe(401);
    // Principal B presenting A's intent and secret without a valid tag is refused at the edge.
    expect((await fetchFile(d.intentId, `${b.principalId}.${secret}`)).status).toBe(401);
    // With a validly signed capability, B still finds nothing of A's in its own object.
    const { loadKeys } = await import('../src/config');
    const forged = await signFileCapability((await loadKeys(env)).cursor, b.principalId, d.intentId, secret);
    expect((await fetchFile(d.intentId, forged)).status).toBe(404);
    // The tag is bound to the intent id: the same capability on another intent is refused at the edge.
    expect((await fetchFile('Zm9yZ2VkLWludGVudC1pZA', d.capability)).status).toBe(401);
    // A validly signed capability for an intent that does not exist finds nothing.
    const unknown = await signFileCapability((await loadKeys(env)).cursor, a.principalId, 'Zm9yZ2VkLWludGVudC1pZA', secret);
    expect((await fetchFile('Zm9yZ2VkLWludGVudC1pZA', unknown)).status).toBe(404);
    expect((await fetchFile(d.intentId, 'not-a-capability')).status).toBe(401);
    // The legitimate holder still works.
    expect((await fetchFile(d.intentId, d.capability, 'bytes=0-9')).status).toBe(206);
  });

  it('F-03: an expired capability is rejected', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    await runInDurableObject(principalStub(w.principalId), (_i, s) => s.storage.sql.exec('UPDATE transfers SET expires_at = 1'));
    expect((await fetchFile(d.intentId, d.capability)).status).toBe(404);
  });

  it('F-03: a capability dies with the grant', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    await principalStub(w.principalId).denyGrant(w.principalId, w.grantId);
    expect((await fetchFile(d.intentId, d.capability, 'bytes=0-9')).status).toBe(404);
  });

  it('AU-05: revoking the grant mid-download stops the stream at the next check; later Range requests fail', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    const res = await fetchFile(d.intentId, d.capability);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await principalStub(w.principalId).denyGrant(w.principalId, w.grantId);
    let received = first.value!.length;
    let failed = false;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        received += r.value.length;
      }
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(received).toBeLessThan(2_500_000);
    expect((await fetchFile(d.intentId, d.capability, 'bytes=0-9')).status).toBe(404);
  });

  it('disconnecting the account stops a transfer in progress', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    const res = await fetchFile(d.intentId, d.capability);
    const reader = res.body!.getReader();
    await reader.read();
    const disconnect = principalStub(w.principalId).disconnectAccount(w.principalId, w.accountIds[0] as string);
    let failed = false;
    try {
      for (;;) if ((await reader.read()).done) break;
    } catch {
      failed = true;
    }
    await disconnect;
    expect(failed).toBe(true);
  });

  it('limits concurrent transfers: one per account', async () => {
    const w = await setupWorld();
    const d1 = parseDownload(await issue(w));
    const d2 = parseDownload(await issue(w));
    const r1 = await fetchFile(d1.intentId, d1.capability);
    const reader = r1.body!.getReader();
    await reader.read();
    expect((await fetchFile(d2.intentId, d2.capability)).status).toBe(409);
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));
    expect((await fetchFile(d2.intentId, d2.capability, 'bytes=0-9')).status).toBe(206);
  });

  it('limits concurrent transfers: two per principal', async () => {
    const w = await setupWorld({ accounts: 3 });
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const statuses: number[] = [];
    for (const accountId of w.accountIds) {
      const r = await callTool(w.token, 'get_media', { account_id: accountId, peer: PEER, message_id: BIG_OK });
      const d = parseDownload(r);
      const res = await fetchFile(d.intentId, d.capability);
      statuses.push(res.status);
      if (res.status === 200) {
        const rd = res.body!.getReader();
        await rd.read();
        readers.push(rd);
      }
    }
    expect(statuses).toEqual([200, 200, 409]);
    await Promise.all(readers.map((r) => r.cancel()));
  });

  it('a mid-stream upstream failure errors the stream instead of truncating silently', async () => {
    const w = await setupWorld();
    const d = parseDownload(await issue(w));
    syntheticControl.streamErrorAfterBytes = 100_000;
    const res = await fetchFile(d.intentId, d.capability);
    let failed = false;
    try {
      await res.arrayBuffer();
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('get_media_info returns metadata without creating an intent', async () => {
    const w = await setupWorld();
    const r = await callTool(w.token, 'get_media_info', { account_id: w.accountIds[0], peer: PEER, message_id: TOO_BIG });
    expect(r.isError).toBe(false);
    expect((r.data.media as { size: number }).size).toBe(9_000_000);
    const n = await runInDurableObject(principalStub(w.principalId), (_i, s) => s.storage.sql.exec('SELECT COUNT(*) AS n FROM transfers').one().n);
    expect(n).toBe(0);
  });
});
