import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations(path.resolve(import.meta.dirname, '../../migrations/admin'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // postun-auth is not part of this test run: CONTROL is replaced per test with a fake (see test/helpers.ts).
      miniflare: { bindings: { TEST_MIGRATIONS: migrations }, serviceBindings: { CONTROL: () => new Response(null, { status: 500 }) } }
    })
  ],
  test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] }
});
