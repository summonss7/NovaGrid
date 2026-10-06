import { defineConfig, devices } from '@playwright/test'

// E2e гоняются против dev-сервера Vite (сборку проверяет отдельный шаг build).
// В CI поднимается свой сервер (reuseExistingServer: false), локально
// подхватывается уже запущенный `npm run dev`.
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
