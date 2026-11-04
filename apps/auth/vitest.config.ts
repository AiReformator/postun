import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
// Synthetic, test-only key material (32 bytes each). Never real secrets.
const key = (n: number): string => Buffer.alloc(32, n).toString('base64url');

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, '../../migrations/control'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // The real VAULT service (postun-mcp) does not exist in unit tests; tests inject a double.
          serviceBindings: { VAULT: () => new Response('vault is replaced by a test double', { status: 599 }) },
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ENV: 'test',
            TELEGRAM_OIDC_CLIENT_ID: 'test-bot-id',
            TELEGRAM_OIDC_CLIENT_SECRET: 'test-bot-secret',
            IDENTITY_INDEX_HMAC_KEY: key(1),
            IDENTITY_ENCRYPTION_KEY: key(2),
            WEB_SESSION_KEY: key(3),
            REGISTRATION_OPEN: 'true'
          }
        }
      })
    ],
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] }
  };
});
