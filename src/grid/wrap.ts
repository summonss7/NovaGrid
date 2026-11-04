/*
 * Перенос текста в ячейке (novagrid-048): разбиение отображаемого текста по
 * словам под ширину колонки и автовысота строки под число строк — как в
 * Excel. Измерение ширины строк делегировано колбэку measure (канвас в
 * GridCanvas, детерминированный фейк в юнит-тестах) — модуль чистый от DOM.
 */

import { mergeAt } from '../core/merges'
import { formatCellDisplay, type CellStyle, type SheetModel } from '../core/sheet'
import { cellText } from '../formula/engine'

/** Горизонтальный отступ текста в ячейке — тот же, что у рендера (pad = 6). */
export const WRAP_PAD_X = 6
/** Межстрочный интервал переноса — доля от px шрифта (как в Excel ≈1,3). */
export const WRAP_LINE_K = 1.32

/** Измеритель ширины строки: (текст, canvas font) → px. */
export type MeasureText = (text: string, font: string) => number

/** Метрики строк переноса: высота ячейки = padY·2 + lineH·n (не ниже базовой). */
export interface WrapMetrics {
  lineH: number
  padY: number
}

/** Метрики строк под px шрифта и базовую высоту строки (одна строка центрирована как обычная ячейка). */
export function wrapLineMetrics(px: number, baseRowH: number): WrapMetrics {
  const lineH = Math.ceil(px * WRAP_LINE_K)
  const padY = Math.max(2, Math.floor((baseRowH - lineH) / 2))
  return { lineH, padY }
}

/** Высота ячейки под n строк переноса — не меньше базовой высоты строки. */
export function wrapHeight(n: number, m: WrapMetrics, baseRowH: number): number {
  return Math.max(baseRowH, m.padY * 2 + m.lineH * n)
}

/**
 * Разбить текст на строки по словам под ширину maxW (novagrid-048): явные
 * переводы строки — свои абзацы; слово шире maxW ломается по символам
 * (как в Excel). Пустой текст — пустой список.
 */
export function wrapLines(text: string, font: string, maxW: number, measure: MeasureText): string[] {
  if (text === '') return []
  if (maxW <= 0) return [text]
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter((w) => w !== '')
    let line = ''
    const pushOversize = () => {
      // слово-переросток: максимальный влезающий префикс, остаток — дальше
      while (measure(line, font) > maxW && line.length > 1) {
        let lo = 1
        let hi = line.length - 1
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2)
          if (measure(line.slice(0, mid), font) <= maxW) lo = mid
          else hi = mid - 1
        }
        out.push(line.slice(0, lo))
        line = line.slice(lo)
      }
    }
    for (const word of words) {
      if (line === '') {
        line = word
      } else if (measure(`${line} ${word}`, font) <= maxW) {
        line = `${line} ${word}`
      } else {
        out.push(line)
        line = word
      }
      pushOversize()
    }
    if (line !== '') out.push(line)
    if (words.length === 0) out.push('') // пустой абзац (\n\n) — своя строка
  }
  return out
}

/** Зависимости измерения: ширины колонок, шрифты и локаль отображения. */
export interface WrapDeps {
  /** ширина колонки c в px экрана (раскладка с переопределениями и зумом) */
  colWidth: (c: number) => number
  /** canvas font стиля ячейки (гарнитура/размер/Ж/К) */
  fontOf: (style: CellStyle) => string
  /** размер шрифта стиля в px */
  pxOf: (style: CellStyle) => number
  measure: MeasureText
  /** тег локали — формат числа меняет отображаемый текст (novagrid-045) */
  locale: string
  /** базовая высота строки грида (с учётом зума) */
  baseRowH: number
}

/**
 * Автовысоты строк с переносом (novagrid-048): по каждой ячейке со стилем
 * wrap — число строк под ширину её колонки; высота строки — максимум по её
 * ячейкам (обычные ячейки высоту не растят, как в Excel). Объединённые
 * ячейки автовысоту не растят: их площадь и так выше одной строки, текст
 * раскладывается по всей площади объединения и обрезается краем.
 * Возвращает модельный номер строки → высота в px (только выросшие).
 */
export function wrapRowHeights(sheet: SheetModel, deps: WrapDeps): Map<number, number> {
  const out = new Map<number, number>()
  for (const [key, style] of sheet.styles) {
    if (!style.wrap) continue
    const sep = key.indexOf(':')
    const r = Number(key.slice(0, sep))
    const c = Number(key.slice(sep + 1))
    const raw = sheet.cells.get(key)
    if (raw === undefined || raw === '') continue
    if (mergeAt(sheet, r, c)) continue
    // отображаемый текст: формулы — вычисленное значение, формат числа применяется
    const computed = raw.startsWith('=') && raw.trim().length > 1 ? cellText(sheet, r, c) : raw
    const text = style.fmt ? formatCellDisplay(computed, style.fmt, deps.locale) : computed
    if (text === '') continue
    const metrics = wrapLineMetrics(deps.pxOf(style), deps.baseRowH)
    const lines = wrapLines(
      text,
      deps.fontOf(style),
      Math.max(1, deps.colWidth(c) - WRAP_PAD_X * 2),
      deps.measure,
    )
    const h = wrapHeight(lines.length, metrics, deps.baseRowH)
    if (h > deps.baseRowH && h > (out.get(r) ?? 0)) out.set(r, h)
  }
  return out
}
