// Растеризация favicon.svg в PNG-иконки PWA (192/512/maskable/apple-touch).
// Запуск: node scripts/make-icons.mjs — правит только public/icons и apple-touch-icon.png.
// Иконки коммитятся в репозиторий: перегенерация нужна лишь при смене знака.

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const svg = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8')
const outDir = resolve(root, 'public/icons')
mkdirSync(outDir, { recursive: true })

/**
 * @param {number} size сторона холста в px
 * @param {number} innerScale доля холста под знаком (маскируемые иконки —
 *   контент в безопасной зоне 80 %, у обычных — полный размер)
 */
async function render(browser, size, innerScale, file) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  // viewBox знака — 48: масштаб = size * innerScale / 48
  const s = (size * innerScale) / 48
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:#fff}
      svg{display:block;width:${(size * innerScale).toFixed(2)}px;height:${(size * innerScale).toFixed(2)}px}
    </style></head><body>${svg.replace('<svg ', `<svg style="transform:scale(${s.toFixed(4)});transform-origin:0 0" `)}</body></html>`,
  )
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } })
  writeFileSync(file, png)
  await page.close()
  console.log('ok', file)
}

const browser = await chromium.launch()
await render(browser, 192, 1, resolve(outDir, 'pwa-192.png'))
await render(browser, 512, 1, resolve(outDir, 'pwa-512.png'))
await render(browser, 512, 0.78, resolve(outDir, 'pwa-512-maskable.png'))
await render(browser, 180, 0.9, resolve(root, 'public/apple-touch-icon.png'))
await browser.close()
