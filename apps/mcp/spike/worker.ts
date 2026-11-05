/**
 * B1 transport spike: proves (or disproves) that mtcute runs inside the real Workers runtime.
 * Not deployed to production. Outputs only timings and safe error classes — never session data.
 */
import { TelegramClient, MemoryStorage } from '@mtcute/web';
import { WebCryptoProvider } from '@mtcute/web';
import { WebSocketTransport } from '@mtcute/web';
// Workers forbid compiling WASM from bytes at runtime; a statically imported module is allowed.
import wasmModule from '../../../node_modules/@mtcute/wasm/mtcute.wasm';

interface Env { TELEGRAM_API_ID?: string; TELEGRAM_API_HASH?: string }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/spike') return new Response('not found', { status: 404 });
    const t0 = Date.now();
    const steps: Record<string, unknown> = {};
    const tg = new TelegramClient({
      apiId: Number(env.TELEGRAM_API_ID ?? '0') || 1,
      apiHash: env.TELEGRAM_API_HASH ?? '00000000000000000000000000000000',
      storage: new MemoryStorage(),
      crypto: new WebCryptoProvider({ wasmInput: wasmModule }),
      transport: new WebSocketTransport(),
      logLevel: 1,
      disableUpdates: true
    });
    try {
      await tg.connect();
      steps.connect_ms = Date.now() - t0;
      const cfg = await tg.call({ _: 'help.getNearestDc' });
      steps.nearest_dc = cfg.nearestDc;
      steps.this_dc = cfg.thisDc;
      steps.call_ms = Date.now() - t0;
      steps.result = 'TRANSPORT_OK';
    } catch (e) {
      const err = e as { code?: number; text?: string; name?: string };
      steps.result = 'ERROR';
      steps.error_class = err.name ?? 'Error';
      steps.error_code = err.code ?? null;
      steps.error_text = typeof err.text === 'string' ? err.text : null; // Telegram RPC error tag only
      steps.elapsed_ms = Date.now() - t0;
    } finally {
      await tg.destroy().catch(() => undefined);
    }
    return Response.json(steps);
  }
};
