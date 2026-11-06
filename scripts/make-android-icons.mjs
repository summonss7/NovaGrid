// Источник иконок Android-обёртки (novagrid-058): рендер favicon.svg в
// desktop/icons/source-1024.png — вход `tauri icon`, который раскладывает
// знак по mipmap-папкам gen/android (ic_launcher*). Приём тот же, что у
// scripts/make-desktop-icons.mjs (знак скругляется сам, фон прозрачный).
// Запуск: node scripts/make-android-icons.mjs (нужен playwright-chromium),
// затем ../node_modules/.bin/tauri icon desktop/icons/source-1024.png
// (или npm run android:icons из корня). Исходник коммитится — как desktop/icons.

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const svg = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8')
const outDir = resolve(root, 'desktop/icons')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(
  `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent}
    svg{display:block;width:1024px;height:1024px}
  </style></head><body>${svg}</body></html>`,
)
const png = await page.screenshot({
  clip: { x: 0, y: 0, width: 1024, height: 1024 },
  omitBackground: true,
})
await browser.close()

writeFileSync(resolve(outDir, 'source-1024.png'), png)
console.log('ok', resolve(outDir, 'source-1024.png'))
