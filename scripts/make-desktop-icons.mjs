// Иконки десктоп-оболочки Tauri (Этап 7.5): растеризация favicon.svg в
// desktop/icons — многослойный icon.ico (exe/проводник/ассоциации) + PNG,
// которые tauri.conf.json перечисляет в bundle.icon.
// Запуск: node scripts/make-desktop-icons.mjs (нужен playwright-chromium).
// Иконки коммитятся в репозиторий — перегенерация лишь при смене знака
// (тот же подход, что public/icons у PWA, scripts/make-icons.mjs).

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const svg = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8')
const outDir = resolve(root, 'desktop/icons')
mkdirSync(outDir, { recursive: true })

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function renderPng(browser, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:#fff}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${svg}</body></html>`,
  )
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
  return png
}

/**
 * ICO с PNG-записями (Vista+): заголовок + 16-байтные директории + данные.
 * Размер 256 в поле размера кодируется нулём (по спецификации формата).
 */
function packIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(([size, png], i) => {
    const base = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, base)
    dir.writeUInt8(size >= 256 ? 0 : size, base + 1)
    dir.writeUInt8(0, base + 2) // палитры нет
    dir.writeUInt8(0, base + 3)
    dir.writeUInt16LE(1, base + 4) // planes
    dir.writeUInt16LE(32, base + 6) // bpp
    dir.writeUInt32LE(png.length, base + 8)
    dir.writeUInt32LE(offset, base + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map(([, png]) => png)])
}

const browser = await chromium.launch()
const entries = []
for (const size of ICO_SIZES) {
  const png = await renderPng(browser, size)
  entries.push([size, png])
  console.log('ok', `${size}x${size}`)
}
await browser.close()

writeFileSync(resolve(outDir, 'icon.ico'), packIco(entries))
writeFileSync(resolve(outDir, '32x32.png'), entries[2][1])
writeFileSync(resolve(outDir, '128x128.png'), entries[5][1])
writeFileSync(resolve(outDir, '128x128@2x.png'), entries[6][1])
console.log('ok', resolve(outDir, 'icon.ico'))
