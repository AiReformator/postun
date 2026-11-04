import { describe, expect, it } from 'vitest';

// Offline check only: proves the real adapter module (mtcute + the bundled WASM) loads and builds a
// client in the Workers runtime. No network, no Telegram account: real MTProto is NOT_RUN here.
describe('real mtcute adapter (offline smoke)', () => {
  it('loads, constructs a client and rejects an invalid session string with a safe error', async () => {
    const { MtcuteAdapter } = await import('../src/telegram/mtcute');
    const adapter = new MtcuteAdapter(12345, '0'.repeat(32));
    const err = await adapter.open('not-a-session').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBeDefined();
    expect(String((err as Error).message)).not.toContain('not-a-session');
  });
});
