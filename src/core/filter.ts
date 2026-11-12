/*
 * Модель фильтрации (CONCEPT Ф3, Этап 3): фильтры по колонкам, несколько
 * фильтров объединяются по «И». Фильтрация недеструктивна — данные не
 * трогаются, вычисляется лишь список видимых строк контента (0..maxRow).
 *
 * Значение ячейки — отображаемая строка (формулы уже вычислены);
 * '' кодирует пустую ячейку — «(Пустые)» в UI. Сортировка (Ф8) переставляет
 * значения в позициях видимых строк: скрытые строки остаются скрытыми.
 */

import { cellText } from '../formula/engine'
import { parseNumber, type SheetModel } from './sheet'

export type FilterMode = 'include' | 'exclude'

export interface ColumnFilter {
  col: number
  /** include — показывать только перечисленные значения; exclude — все, кроме них */
  mode: FilterMode
  /** значения ячеек; '' — пустая ячейка */
  values: string[]
  /**
   * Текстовое условие «содержит слово» (novagrid-069): задано — ячейка
   * проходит по вхождению подстроки (без учёта регистра), values игнорируются.
   * Фильтр по слову из длинных значений: «патрубок» найдёт «патрубок
   * воздушного фильтра». undefined — обычный фильтр по значениям.
   */
  text?: string
}

/** Фильтр с пустым списком значений и без слова ничего не делает (вырожденный). */
export function isActiveFilter(f: ColumnFilter): boolean {
  return isTextFilter(f) ? f.text.trim() !== '' : f.values.length > 0
}

/** Текстовый фильтр («содержит слово») — поле text задано. */
export function isTextFilter(f: ColumnFilter): f is ColumnFilter & { text: string } {
  return f.text !== undefined
}

export function valuePasses(f: ColumnFilter, raw: string): boolean {
  if (isTextFilter(f)) {
    const hit = raw.toLowerCase().includes(f.text.trim().toLowerCase())
    return f.mode === 'include' ? hit : !hit
  }
  const hit = f.values.includes(raw)
  return f.mode === 'include' ? hit : !hit
}

/**
 * Видимые строки при данных фильтрах; null — активных фильтров нет и видны
 * все (важно для стресс-режима 100k: без фильтров не платим аллокациями).
 */
export function visibleRowsOf(
  sheet: SheetModel,
  filters: readonly ColumnFilter[],
): readonly number[] | null {
  const active = filters.filter(isActiveFilter)
  if (active.length === 0) return null
  // значения — в Set: список из сотен галочек меню колонки не должен делать
  // каждую из 100k строк линейным сканом (Этап 6.1); слово — заранее в нижнем
  // регистре, чтобы не приводить его на каждой строке
  const prepared = active.map((f) => ({
    f,
    needle: isTextFilter(f) ? f.text.trim().toLowerCase() : null,
    set: !isTextFilter(f) && f.values.length > 8 ? new Set(f.values) : null,
  }))
  const out: number[] = []
  for (let r = 0; r <= sheet.maxRow; r++) {
    let ok = true
    for (const { f, needle, set } of prepared) {
      const raw = cellText(sheet, r, f.col)
      const hit =
        needle !== null
          ? raw.toLowerCase().includes(needle)
          : set
            ? set.has(raw)
            : f.values.includes(raw)
      if (f.mode === 'include' ? !hit : hit) {
        ok = false
        break
      }
    }
    if (ok) out.push(r)
  }
  return out
}

/** Бинарный поиск строки в возрастающем списке видимых; −1 — строка скрыта. */
export function visibleIndexOf(visible: readonly number[], row: number): number {
  let lo = 0
  let hi = visible.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = visible[mid]
    if (v === row) return mid
    if (v < row) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

export function isRowVisible(visible: readonly number[] | null, row: number): boolean {
  return visible === null || visibleIndexOf(visible, row) >= 0
}

/** Ближайшая видимая строка в направлении dr — навигация сквозь скрытые. */
export function nearestVisibleRow(
  visible: readonly number[] | null,
  row: number,
  dr: number,
): number {
  if (!visible || visible.length === 0) return row
  if (visibleIndexOf(visible, row) >= 0) return row
  if (dr >= 0) {
    for (const v of visible) if (v > row) return v
    return visible[visible.length - 1]
  }
  for (let i = visible.length - 1; i >= 0; i--) if (visible[i] < row) return visible[i]
  return visible[0]
}

export interface ColumnValueCount {
  value: string
  count: number
}

/** Различные значения колонки с количеством — для меню колонки (Ф3.7). */
export function columnValueCounts(sheet: SheetModel, col: number): ColumnValueCount[] {
  const counts = new Map<string, number>()
  let blanks = 0
  for (let r = 0; r <= sheet.maxRow; r++) {
    const raw = cellText(sheet, r, col)
    if (raw === '') {
      blanks++
      continue
    }
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  if (blanks > 0) counts.set('', blanks)
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => compareCellValues(a.value, b.value))
}

const textCollator = new Intl.Collator('ru', { sensitivity: 'base' })

/**
 * Сравнение значений колонки (Ф8, список значений меню): числа — числово и
 * раньше текста, текст — без учёта регистра по русской локали, пустые —
 * всегда в конце (Excel так же держит пустые при сортировке).
 */
export function compareCellValues(a: string, b: string): number {
  if (a === b) return 0
  if (a === '') return 1
  if (b === '') return -1
  const na = parseNumber(a)
  const nb = parseNumber(b)
  if (na !== null && nb !== null) return na - nb
  if (na !== null) return -1
  if (nb !== null) return 1
  return textCollator.compare(a, b)
}
