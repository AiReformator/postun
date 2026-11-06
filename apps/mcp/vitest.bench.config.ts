import { defineConfig } from 'vitest/config';

// Plain Node project (no workerd): the CPU benchmark of the Worker's request path. See bench/cpu.bench.test.ts.
// The MCP SDK is resolved with the same export conditions wrangler uses ("workerd"), so the code under test matches
// the deployed bundle (Workers shim with eager schema warm-up, CfWorker JSON-schema validator) rather than the Node one.
export default defineConfig({
  resolve: { conditions: ['workerd', 'worker', 'browser'] },
  ssr: { resolve: { conditions: ['workerd', 'worker', 'browser'] } },
  test: {
    include: ['bench/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    server: { deps: { inline: [/@modelcontextprotocol/] } }
  }
});
