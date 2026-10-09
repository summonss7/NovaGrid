import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base './' — относительные пути к ассетам, чтобы сборка отдавалась
// и с подкаталога GitHub Pages (https://<owner>.github.io/NovaGrid/)
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // PWA-оболочка (Этап 5.1): precache оболочки приложения — офлайн-работа
    // целиком (все вычисления и так локальные). registerType 'prompt' — новая
    // версия не перезагружает страницу сама: сессия (правки в IndexedDB)
    // не теряется, пользователь обновляет по кнопке в тосте.
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'NovaGrid — таблицы без изучения Excel',
        short_name: 'NovaGrid',
        description:
          'Откройте xls/xlsx/csv, найдите, отфильтруйте и сложите — всё считается локально в браузере',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#ededeb',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // демо-файлы не в precache (стресс-CSV тяжёлый) — кэшируются при
        // первом обращении с стартового экрана и дальше работают офлайн
        navigateFallbackDenylist: [/fixtures/],
        runtimeCaching: [
          {
            urlPattern: /\/fixtures\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'novagrid-fixtures',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
