import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['line']] : [['list']],
  use: { trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
})
