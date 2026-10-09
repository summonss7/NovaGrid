import { defineConfig, devices } from '@playwright/test'

// E2e гоняются против dev-сервера Vite (сборку проверяет отдельный шаг build).
// В CI поднимается свой сервер (reuseExistingServer: false), локально
// подхватывается уже запущенный `npm run dev`.
//
// Матрица платформ (Этап 6.4): полный набор — chromium; firefox/webkit —
// смок-подмножество с тегом @smoke; mobile — Android-эмуляция Pixel 7
// (chromium) с тегом @mobile. @mobile исключён из десктоп-набора: тач-тесты
// имеют смысл только с эмулированным тачскрином.
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
      grepInvert: /@mobile/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: /@smoke/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@smoke/,
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
