/*
 * Операции вставки/удаления строк и колонок (novagrid-045) — чистые функции
 * над листом: значения и стили сдвигаются, формулы перестраиваются ремапом
 * ссылок (remapRefsOnShift), границы листа только растут. Результат — снимки
 * до/после: история хранит их целиком (дифф тысяч ячеек неэкономен), а
 * пересчёт формул делегирован движку (пустой список правок = полный пересчёт).
 */

import { remapRefsOnShift } from '../formula/parser'
import { cellKey, MAX_COLS, MAX_ROWS, type SheetModel } from './sheet'

/** Сдвиг листа по строкам: delta > 0 — вставка, delta < 0 — удаление −delta. */
export function shiftSheetRows(sheet: SheetModel, at: number, delta: number): SheetModel {
  if (delta === 0 || at < 0) return sheet
  const cells = new Map<string, string>()
  for (const [key, raw] of sheet.cells) {
    const sep = key.indexOf(':')
    const r = Number(key.slice(0, sep))
    const c = Number(key.slice(sep + 1))
    if (delta < 0 && r >= at && r < at - delta) continue // удалённая зона
    const nr = r >= at ? r + delta : r
    if (nr < 0 || nr >= MAX_ROWS) continue
    const value = raw.startsWith('=') ? remapRefsOnShift(raw, 'row', at, delta) : raw
    if (value !== '') cells.set(cellKey(nr, c), value)
  }
  const styles = shiftMapKeys(sheet.styles, at, delta, 'row')
  return {
    ...sheet,
    cells,
    styles,
    formulaCache: undefined,
    rows: delta > 0 ? Math.min(MAX_ROWS, sheet.rows + delta) : sheet.rows,
    maxRow: delta > 0 ? Math.min(MAX_ROWS - 1, Math.max(-1, sheet.maxRow + delta)) : sheet.maxRow,
  }
}

/** Сдвиг листа по колонкам: delta > 0 — вставка, delta < 0 — удаление −delta. */
export function shiftSheetCols(sheet: SheetModel, at: number, delta: number): SheetModel {
  if (delta === 0 || at < 0) return sheet
  const cells = new Map<string, string>()
  for (const [key, raw] of sheet.cells) {
    const sep = key.indexOf(':')
    const r = Number(key.slice(0, sep))
    const c = Number(key.slice(sep + 1))
    if (delta < 0 && c >= at && c < at - delta) continue
    const nc = c >= at ? c + delta : c
    if (nc < 0 || nc >= MAX_COLS) continue
    const value = raw.startsWith('=') ? remapRefsOnShift(raw, 'col', at, delta) : raw
    if (value !== '') cells.set(cellKey(r, nc), value)
  }
  const styles = shiftMapKeys(sheet.styles, at, delta, 'col')
  return {
    ...sheet,
    cells,
    styles,
    formulaCache: undefined,
    cols: delta > 0 ? Math.min(MAX_COLS, sheet.cols + delta) : sheet.cols,
    maxCol: delta > 0 ? Math.min(MAX_COLS - 1, Math.max(-1, sheet.maxCol + delta)) : sheet.maxCol,
  }
}

/** Перенос ключей Map (значения или стили) при сдвиге строк/колонок. */
function shiftMapKeys<V>(
  src: ReadonlyMap<string, V>,
  at: number,
  delta: number,
  axis: 'row' | 'col',
): Map<string, V> {
  const out = new Map<string, V>()
  const limit = axis === 'row' ? MAX_ROWS : MAX_COLS
  for (const [key, v] of src) {
    const sep = key.indexOf(':')
    const r = Number(key.slice(0, sep))
    const c = Number(key.slice(sep + 1))
    const own = axis === 'row' ? r : c
    if (delta < 0 && own >= at && own < at - delta) continue
    const shifted = own >= at ? own + delta : own
    if (shifted < 0 || shifted >= limit) continue
    out.set(axis === 'row' ? cellKey(shifted, c) : cellKey(r, shifted), v)
  }
  return out
}

/**
 * Ширины колонок после вставки/удаления: переопределения переезжают вместе
 * со своими колонками; ширина удалённых пропадает.
 */
export function shiftColWidths(
  widths: ReadonlyMap<number, number> | null,
  at: number,
  delta: number,
): ReadonlyMap<number, number> | null {
  if (!widths || delta === 0) return widths
  const out = new Map<number, number>()
  for (const [c, w] of widths) {
    if (delta < 0 && c >= at && c < at - delta) continue
    const nc = c >= at ? c + delta : c
    if (nc >= 0) out.set(nc, w)
  }
  return out.size > 0 ? out : null
}

/** Фильтры колонок после вставки/удаления колонок: индексы сдвигаются. */
export function shiftFilterCols<T extends { col: number }>(
  filters: readonly T[],
  at: number,
  delta: number,
): T[] {
  if (delta === 0) return filters as T[]
  return filters.flatMap((f) => {
    if (delta < 0 && f.col >= at && f.col < at - delta) return []
    const nc = f.col >= at ? f.col + delta : f.col
    return nc >= 0 ? [{ ...f, col: nc }] : []
  })
}

/**
 * Закрепление после вставки/удаления (novagrid-044/045): закреплённая зона
 * держится над теми же данными — вставка внутри зоны расширяет её, удаление
 * сжимает (не меньше 0).
 */
export function shiftFreeze(
  freeze: { rows: number; cols: number },
  axis: 'row' | 'col',
  at: number,
  delta: number,
): { rows: number; cols: number } {
  const own = axis === 'row' ? freeze.rows : freeze.cols
  if (own <= at) return freeze
  const next = Math.max(0, own + delta)
  return axis === 'row' ? { rows: next, cols: freeze.cols } : { rows: freeze.rows, cols: next }
}
