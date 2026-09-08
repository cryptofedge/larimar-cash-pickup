import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Load .env into this process before Vitest forks its workers. Forked children
// inherit process.env, so integration tests get DATABASE_URL and the secrets
// that src/server/env.ts validates at import time. Node built-in, no dotenv.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Two projects, deliberately separated.
 *
 * `unit` covers the pure financial core and runs with no database, no network,
 * and no clock — it is fast enough to run on every save, which is the only way
 * money logic actually gets tested.
 *
 * `integration` exercises services against a real PostgreSQL, because the things
 * that matter there (serialisable transactions, unique constraints, concurrent
 * redemption) cannot be proven against a mock.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
        },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // Financial integration tests share one database; running them in
          // parallel would produce false failures that hide real ones. A single
          // fork serialises every file in this project.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
