/*
 * Контраст-аудит WCAG (Этап 6.2): пары «текст/фон» из дизайн-токенов
 * против фактического использования в ui.css. Пороги AA: 4.5:1 обычный
 * текст, 3:1 крупный (≥18.66px bold / ≥24px) и UI-элементы.
 * Этап 7.2 (тёмная тема): два прохода — светлый набор (:root) и тёмный
 * (:root[data-theme='dark'], наследует незаданное у светлого); полупрозрачные
 * заливки состояний компонуются поверх фона своей темы.
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

// разбор блока токенов: hex-палитра и rgba-состояния (для композиций)
const parseTokens = (css) => {
  const tokens = {}
  for (const m of css.matchAll(/--nv-[a-z-]+:\s*(#[0-9a-fA-F]{6}|rgba\([^)]+\))/g)) {
    tokens[m[0].split(':')[0]] = m[1]
  }
  return tokens
}

const parseRgba = (s) => {
  const m = s.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/)
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: +m[4] } : null
}
const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
/** полупрозрачная заливка состояний ячеек поверх фона темы */
const over = (fill, baseHex) => {
  const f = parseRgba(fill)
  if (!f) return fill
  const [br, bg, bb] = [1, 3, 5].map((i) => parseInt(baseHex.slice(i, i + 2), 16))
  return toHex(f.a * f.r + (1 - f.a) * br, f.a * f.g + (1 - f.a) * bg, f.a * f.b + (1 - f.a) * bb)
}

const css = readFileSync('src/ui/tokens.css', 'utf8')
let lightBody = ''
let darkBody = ''
for (const [, sel, body] of css.matchAll(/(:root(?:\[data-theme='dark'\])?)\s*\{([^}]*)\}/g)) {
  if (sel === ':root') lightBody = body
  else darkBody = body
}
if (!lightBody) throw new Error('светой набор :root не найден в tokens.css')
if (!darkBody) throw new Error("тёмный набор :root[data-theme='dark'] не найден в tokens.css")
const light = parseTokens(lightBody)
// тёмный набор переопределяет только часть ролей — остальное наследует светлый
const dark = { ...light, ...parseTokens(darkBody) }

// пары по фактическим ролям (DESIGN-SYSTEM §2 + ui.css): [фон, текст, порог, где]
const pairsFor = (T) => {
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
  // композиции полупрозрачных состояний ячеек поверх фона ячеек темы
  const bg = T('--nv-bg')
  pairs.push([
    over(T('--nv-cell-selected-bg'), bg),
    T('--nv-ink'),
    4.5,
    'текст в выделенной ячейке (лайм-заливка)',
  ])
  pairs.push([over(T('--nv-cell-alt-bg'), bg), T('--nv-ink'), 4.5, 'текст в Alt-лассо (оранж-заливка)'])
  // главные кнопки: белый текст на зелёном (Этап 6.2 — AA)
  pairs.push([T('--nv-primary-btn'), '#ffffff', 4.5, 'белый текст на главной кнопке'])
  pairs.push([T('--nv-primary-btn-hover'), '#ffffff', 4.5, 'белый текст на hover главной'])
  // оранжевая кнопка Σ (крупный символ)
  pairs.push([T('--nv-accent'), '#ffffff', 3, 'белый Σ на оранжевой кнопке (крупный)'])
  pairs.push([T('--nv-accent-deep'), '#ffffff', 3, 'белый Σ на hover оранжевой (крупный)'])
  return pairs
}

const runPass = (name, tokens) => {
  const T = (token) => {
    if (!tokens[token]) throw new Error(`нет токена ${token}`)
    return tokens[token]
  }
  let fails = 0
  console.log(`\n— ${name} —`)
  for (const [bgRaw, fgRaw, min, where] of pairsFor(T)) {
    const [bg, fg] = [bgRaw.startsWith('--nv-') ? T(bgRaw) : bgRaw, fgRaw.startsWith('--nv-') ? T(fgRaw) : fgRaw]
    const r = Math.round(ratio(bg, fg) * 100) / 100
    const ok = r >= min
    if (!ok) fails++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${String(r).padStart(6)}:1  (нужно ≥${min})  ${fg} на ${bg} — ${where}`,
    )
  }
  return fails
}

console.log('Контраст-аудит WCAG AA (пары токенов → факт использования, обе темы)')
const fails = runPass('Светлая тема (:root)', light) + runPass("Тёмная тема (:root[data-theme='dark'])", dark)
console.log(`\n${fails === 0 ? '✓ все пары обеих тем проходят AA' : `✗ провалов: ${fails}`}`)
process.exit(fails === 0 ? 0 : 1)
