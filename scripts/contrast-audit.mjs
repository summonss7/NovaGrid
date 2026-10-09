/*
 * Контраст-аудит WCAG (Этап 6.2): пары «текст/фон» из дизайн-токенов
 * против фактического использования в ui.css. Пороги AA: 4.5:1 обычный
 * текст, 3:1 крупный (≥18.66px bold / ≥24px) и UI-элементы.
 * Запуск: node scripts/contrast-audit.mjs — ненулевой код, если есть провал.
 */

import { readFileSync } from 'node:fs'

const lum = (hex) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
const parseTokens = (css) => {
  const tokens = {}
  for (const m of css.matchAll(/--nv-[a-z-]+:\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[m[0].split(':')[0]] = m[1]
  }
  return tokens
}

const tokens = parseTokens(readFileSync('src/ui/tokens.css', 'utf8'))
const T = (name) => {
  if (!tokens[name]) throw new Error(`нет токена ${name}`)
  return tokens[name]
}

// пары по фактическим ролям (DESIGN-SYSTEM §2 + ui.css): [фон, текст, порог, где]
// rgba-заливки (выделение 0.12 поверх белого) посчитаны как композиция на white
const over = (fgHex, alpha, baseHex = '#ffffff') => {
  const mix = (c, b) => Math.round(c * alpha + b * (1 - alpha))
  const h = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [fr, fg, fb] = h(fgHex)
  const [br, bg, bb] = h(baseHex)
  return (
    '#' + [mix(fr, br), mix(fg, bg), mix(fb, bb)].map((v) => v.toString(16).padStart(2, '0')).join('')
  )
}

const pairs = [
  // основной текст
  ['--nv-bg', '--nv-ink', 4.5, 'текст ячеек (ink на bg)'],
  ['--nv-surface', '--nv-ink', 4.5, 'текст панелей (ink на surface)'],
  ['--nv-mint', '--nv-ink', 4.5, 'текст подсветки поиска (ink на mint)'],
  // вторичный текст
  ['--nv-bg', '--nv-ink-soft', 4.5, 'подписи/хинты (ink-soft на bg)'],
  ['--nv-surface', '--nv-ink-soft', 4.5, 'подписи панелей (ink-soft на surface)'],
  // зелёный как текст (ссылки, счётчики, логотип)
  ['--nv-bg', '--nv-primary-text', 4.5, 'зелёный текст на bg'],
  ['--nv-surface', '--nv-primary-text', 4.5, 'зелёный текст на surface'],
  ['--nv-mint', '--nv-primary-text', 4.5, 'зелёный текст на мятных чипах'],
  // ошибки
  ['--nv-bg', '--nv-danger-text', 4.5, 'текст ошибок (danger-text на bg)'],
  // акцент: только крупный/UI
  ['--nv-bg', '--nv-accent', 3, 'Σ-символ 20px (крупный) на bg'],
  ['--nv-bg', '--nv-primary-deep', 3, 'рамки/иконки primary-deep (UI 3:1)'],
]

// композиции полупрозрачных состояний ячеек поверх белого фона ячейки
const selectedBg = over('#3adf63', 0.12)
const altBg = over('#f26b21', 0.1)
pairs.push([selectedBg, T('--nv-ink'), 4.5, 'текст в выделенной ячейке (лайм 0.12)'])
pairs.push([altBg, T('--nv-ink'), 4.5, 'текст в Alt-лассо (оранж 0.10)'])

// главные кнопки: белый текст на зелёном (Этап 6.2 — AA)
pairs.push([T('--nv-primary-btn'), '#ffffff', 4.5, 'белый текст на главной кнопке'])
pairs.push([T('--nv-primary-btn-hover'), '#ffffff', 4.5, 'белый текст на hover главной'])
// оранжевая кнопка Σ (крупный символ)
pairs.push([T('--nv-accent'), '#ffffff', 3, 'белый Σ на оранжевой кнопке (крупный)'])
pairs.push([T('--nv-accent-deep'), '#ffffff', 3, 'белый Σ на hover оранжевой (крупный)'])

let fails = 0
console.log('Контраст-аудит WCAG AA (пары токенов → факт использования)\n')
const resolve = (v) => (v.startsWith('--nv-') ? T(v) : v)
for (const [bgRaw, fgRaw, min, where] of pairs) {
  const [bg, fg] = [resolve(bgRaw), resolve(fgRaw)]
  const r = Math.round(ratio(bg, fg) * 100) / 100
  const ok = r >= min
  if (!ok) fails++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${String(r).padStart(6)}:1  (нужно ≥${min})  ${fg} на ${bg} — ${where}`,
  )
}
console.log(`\n${fails === 0 ? '✓ все пары проходят AA' : `✗ провалов: ${fails}`}`)
process.exit(fails === 0 ? 0 : 1)
