// Иконки Android-обёртки (novagrid-058; композиция пересобрана в novagrid-066).
// Источник — public/favicon.svg (тот же знак, что у винды и PWA).
//
// novagrid-066: прежде знак раскладывал `tauri icon` — он вписывал плитку
// знака на ВЕСЬ слой ic_launcher_foreground (безопасная зона адаптивной
// иконки — центральные 66% холста 108dp), и маска лаунчера срезала углы
// плитки и концы оранжевых штрихов, а фон адаптива был белым — знак на
// телефоне выглядел чужим чёрным пятном, не плиткой как в винде. Теперь
// скрипт сам пишет res-файлы gen/android (tauri icon для Android не нужен):
//   • ic_launcher_foreground.png — знак на 72% холста, прозрачные поля:
//     в любом маске лаунчера (66–76%) виден весь знак, края режут только
//     чёрную плитку — фон-то чёрный (см. ниже), шов невидим;
//   • values/ic_launcher_background.xml — #000000: маска лаунчера заливается
//     чёрным, как чёрная плитка знака в винде (был белый);
//   • ic_launcher.png / ic_launcher_round.png (legacy, API 24–25) — знак
//     теми же пропорциями, что иконка винды (плитка на 94% холста,
//     прозрачные скруглённые углы).
// Полный кадр знака по-прежнему пишется в desktop/icons/source-1024.png —
// исходник для iOS (`tauri icon` там раскладывает его в Assets.xcassets).
// Запуск: node scripts/make-android-icons.mjs (нужен playwright-chromium).
// Иконки коммитятся — перегенерация лишь при смене знака.

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const svg = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8')
const outDir = resolve(root, 'desktop/icons')
const resDir = resolve(root, 'desktop/gen/android/app/src/main/res')
mkdirSync(outDir, { recursive: true })

// densities → { legacy: px по 48dp, foreground: px по 108dp }
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

// знак в безопасной зоне адаптива. Гарантированная зона — центральный круг
// 66dp из холста 108dp (r = 30.6% холста); «усы» знака доходят до 0.375
// полуширины знака, их диагональ √2·0.375·S ≤ r → S ≤ 0.576. 57% — кончики
// не режет даже круглая маска (живой замер на эмуляторе: при 72% срезало);
// на диске 72dp знак занимает ~79% — пропорции как у плитки винды
const FOREGROUND_SCALE = 0.57

const browser = await chromium.launch()

async function renderPng(size, scale = 1) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  const px = Math.round(size * scale)
  await page.setContent(
    `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent}
    body{display:flex;align-items:center;justify-content:center}
    svg{display:block;width:${px}px;height:${px}px}
  </style></head><body>${svg}</body></html>`,
  )
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: true,
  })
  await page.close()
  return png
}

// 1) полный кадр 1024 — исходник iOS/справка
writeFileSync(resolve(outDir, 'source-1024.png'), await renderPng(1024))

// 2) res ген/android: adaptive foreground + legacy плитки
for (const [d, legacyPx, fgPx] of DENSITIES) {
  const dir = resolve(resDir, `mipmap-${d}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'ic_launcher_foreground.png'), await renderPng(fgPx, FOREGROUND_SCALE))
  // legacy — как иконка винды: плитка знака теми же пропорциями viewBox
  const legacy = await renderPng(legacyPx)
  writeFileSync(resolve(dir, 'ic_launcher.png'), legacy)
  writeFileSync(resolve(dir, 'ic_launcher_round.png'), legacy)
}

// 3) фон адаптива — чёрная плитка знака (был #FFFFFF от шаблона tauri)
writeFileSync(
  resolve(resDir, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#000000</color>\n</resources>`,
)

await browser.close()
console.log(`ok: source-1024.png + gen/android res (foreground ${FOREGROUND_SCALE}, фон #000000, legacy как в винде)`)
