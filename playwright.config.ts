import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'cargo run -p veil-host',
      url: 'http://127.0.0.1:4444/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm dev:web',
      url: 'http://127.0.0.1:5173',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
