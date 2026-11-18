// @ts-check
const { defineConfig, devices } = require('@playwright/test')

// Runs the real API and a production build of the web app against the database in server/.env.
// That database must be migrated and seeded (npx prisma migrate deploy && npx prisma db seed).
// Locally, already-running servers on these ports are reused.
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // CI installs Playwright's Chromium; locally use the installed Chrome to skip the download
      use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'chrome' }) },
    },
  ],
  webServer: [
    {
      command: 'node src/app.js',
      cwd: '../server',
      url: 'http://localhost:3001/api/health/ready',
      reuseExistingServer: !process.env.CI,
      // 'test' turns off the login and sales rate limits, which a fast test run would trip
      env: { NODE_ENV: 'test', PORT: '3001', CORS_ORIGIN: 'http://localhost:4173' },
      timeout: 60_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      cwd: '../client',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
