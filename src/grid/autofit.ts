/*
 * Автоширина колонок по тексту (novagrid-067): ширина каждой колонки —
 * самый широкий отображаемый текст в ней (как «авто» в Excel), с потолком
 * AUTOFIT_MAX_CHARS символов (пожелание: 200–250) и полом COL_W_MIN.
 * Измерение — колбэк measure (канвас в GridCanvas, детерминированный фейк
 * в юнит-тестах), модуль чистый от DOM. Объединённые ячейки не растят
 * ширину колонки — их текст живёт на всей площади объединения (как в
 * автовысоте переноса novagrid-048).
 *
 * Ширины возвращаются в базовых единицах (зум 100 %): зум масштабирует
 * их в colLayoutOf, пересчёт при зуме не нужен. Отображаемый текст — тот
 * же, что у рендера: формулы → вычисленное значение, формат числа →
 * форматирование (wrap.ts считает так же).
 */

import { mergeAt } from '../core/merges'
import { formatCellDisplay, type CellStyle, type SheetModel } from '../core/sheet'
import { cellText } from '../formula/engine'
import { COL_W_MIN } from './geometry'
import type { MeasureText } from './wrap'

/**
 * Потолок автоширины в символах — середина диапазона 200–250 из карточки:
 * колонка с текстом 500+ символов не растягивается на весь экран.
 */
export const AUTOFIT_MAX_CHARS = 220
/** Горизонтальный отступ текста в ячейке — тот же, что у рендера (pad = 6). */
export const AUTOFIT_PAD_X = 6
/** Запас на края знаков при округлении (Excel добавляет похожий люфт). */
const AUTOFIT_MARGIN = 2
/** Знак не шире кегля × этот запас (эмодзи бывают шире 1 em) — для отсева. */
const GLYPH_K = 4 / 3

/** Зависимости измерения — шрифты в базовом масштабе (зум 100 %). */
export interface AutofitDeps {
  measure: MeasureText
  /** canvas font стиля ячейки (гарнитура/размер/Ж/К) в базовом масштабе */
  fontOf: (style: CellStyle | undefined) => string
  /** размер шрифта стиля в px (базовый масштаб) — для дешёвого отсева */
  pxOf: (style: CellStyle | undefined) => number
  /** тег локали — формат числа меняет отображаемый текст */
  locale: string
}

/**
 * Ширины колонок по самому широкому тексту (базовые единицы, зум 100 %):
 * колонки без текста не входят в карту — им остаётся ширина по умолчанию.
 * Тексты длиннее потолка клампятся: колонка режется «…», как в Excel.
 */
export function autoColWidths(sheet: SheetModel, deps: AutofitDeps): Map<number, number> {
  // потолок в px: строка из AUTOFIT_MAX_CHARS цифр базовым шрифтом ячейки
  const cap =
    deps.measure('0'.repeat(AUTOFIT_MAX_CHARS), deps.fontOf(undefined)) +
    AUTOFIT_PAD_X * 2 +
    AUTOFIT_MARGIN
  // колонка → ширина самого широкого текста в px; достигшие потолка — мимо
  const max = new Map<number, number>()
  const capped = new Set<number>()
  for (const [key, raw] of sheet.cells) {
    if (raw === '') continue
    const sep = key.indexOf(':')
    const r = Number(key.slice(0, sep))
    const c = Number(key.slice(sep + 1))
    if (c >= sheet.cols || capped.has(c)) continue
    if (mergeAt(sheet, r, c)) continue
    const style = sheet.styles.get(key)
    // отображаемый текст: формулы — вычисленное значение, формат числа применяется
    const computed = raw.startsWith('=') && raw.trim().length > 1 ? cellText(sheet, r, c) : raw
    if (computed === '') continue
    const text = style?.fmt ? formatCellDisplay(computed, style.fmt, deps.locale) : computed
    // дешёвый отсев: строка короче максимума по числу знаков не меряется —
    // знак не шире кегля (× запас на эмодзи), стресс-листы платят только
    // за реально претендующие на ширину тексты
    const floor = max.get(c) ?? 0
    if (text.length * deps.pxOf(style) * GLYPH_K <= floor) continue
    const w = deps.measure(text, deps.fontOf(style))
    if (w > floor) max.set(c, w)
    if (w + AUTOFIT_PAD_X * 2 + AUTOFIT_MARGIN >= cap) capped.add(c)
  }
  const out = new Map<number, number>()
  for (const [c, w] of max) {
    out.set(c, Math.min(cap, Math.max(COL_W_MIN, Math.round(w + AUTOFIT_PAD_X * 2 + AUTOFIT_MARGIN))))
  }
  return out
}
