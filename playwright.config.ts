import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * End-to-end configuration.
 *
 * Runs against a production build rather than the dev server: dev-mode
 * compilation timing produces flaky waits, and the built output is what actually
 * ships. Tests run serially because they share one database and the demo
 * customer's transaction limits.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // The PWA suite asserts what the service worker caches, so workers must
    // be allowed rather than Playwright's default of blocking them.
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The primary customer is on a phone. If the flow does not work at 393px,
      // it does not work.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testIgnore: /agent|admin/,
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          // `npm run start` serves the production build; say so explicitly, or
          // Next warns about a non-standard NODE_ENV inherited from the runner.
          NODE_ENV: 'production',
          // The suite registers a fresh account per test and signs in
          // repeatedly, all from one address. Production defaults (5
          // registrations/hour, 10 logins/15min) correctly refuse that, so they
          // are raised here rather than weakened in .env.example.
          RATE_LIMIT_REGISTER_PER_HOUR: '500',
          RATE_LIMIT_LOGIN_PER_15MIN: '500',
          // The public quote endpoint buckets by address, and every test shares
          // one address locally.
          RATE_LIMIT_QUOTE_PER_MIN: '1000',
          RATE_LIMIT_DEFAULT_PER_MIN: '1000',
        },
      },
});
