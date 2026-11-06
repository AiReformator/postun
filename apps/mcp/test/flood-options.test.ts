import { describe, expect, it } from 'vitest';
import { FLOOD_DEFAULTS, floodMiddlewares, floodOptionsFromEnv } from '../src/telegram/mtcute';

describe('mtcute flood options', () => {
  it('defaults to sleeping through at most 3 s, once', () => {
    expect(floodOptionsFromEnv({})).toEqual({ autoSleepSeconds: 8, maxRetries: 1 });
    expect(FLOOD_DEFAULTS).toEqual({ autoSleepSeconds: 8, maxRetries: 1 });
  });
  it('accepts overrides and ignores invalid values', () => {
    expect(floodOptionsFromEnv({ FLOOD_AUTO_SLEEP_SECONDS: '0', FLOOD_AUTO_RETRIES: '2' })).toEqual({ autoSleepSeconds: 0, maxRetries: 2 });
    expect(floodOptionsFromEnv({ FLOOD_AUTO_SLEEP_SECONDS: '999', FLOOD_AUTO_RETRIES: 'x' })).toEqual({ autoSleepSeconds: 8, maxRetries: 1 });
  });

  // Runs the real mtcute middleware chain against a fake transport result.
  async function run(errorMessage: string, opts = FLOOD_DEFAULTS) {
    const mw = floodMiddlewares(opts) as unknown as ((ctx: unknown, next: (c: unknown) => Promise<unknown>) => Promise<unknown>)[];
    let calls = 0;
    const final = async () => {
      calls++;
      return { _: 'mt_rpc_error', errorCode: 420, errorMessage };
    };
    const ctx = { request: { _: 'messages.getDialogs' }, params: undefined, manager: { teardownSignal: new AbortController().signal, _log: { warn() {}, info() {}, debug() {} } } };
    const step = (i: number): Promise<unknown> => (i >= mw.length ? final() : (mw[i] as (c: unknown, n: () => Promise<unknown>) => Promise<unknown>)(ctx, () => step(i + 1)));
    const res = (await step(0)) as { errorMessage: string };
    return { calls, res };
  }

  it('does not sleep through or retry a long FLOOD_WAIT: it surfaces after one attempt', async () => {
    const { calls, res } = await run('FLOOD_WAIT_30');
    expect(calls).toBe(1);
    expect(res.errorMessage).toBe('FLOOD_WAIT_30');
  });

  it('retries a short FLOOD_WAIT at most once', async () => {
    const { calls, res } = await run('FLOOD_WAIT_1');
    expect(calls).toBe(2);
    expect(res.errorMessage).toBe('FLOOD_WAIT_1');
  });
});
