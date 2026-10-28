import { defineConfig, devices } from '@playwright/test';

const port = 4410;

// The browsers: Chromium always, Firefox and WebKit when the machine has them (the CI installs all
// three; locally `pnpm exec playwright install firefox webkit` adds them, ALL_BROWSERS=1 runs them)
const all = process.env.ALL_BROWSERS === '1' || process.env.CI !== undefined;

export default defineConfig({
  testDir: 'test',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI === undefined ? 'list' : [['github'], ['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(all
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
  webServer: {
    command: 'node test/server.mjs',
    port,
    env: { PORT: String(port) },
    reuseExistingServer: false,
  },
});
